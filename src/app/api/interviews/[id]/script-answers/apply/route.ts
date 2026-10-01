// T-208 step4: 面談スクリプトの答えを保存し、同じ処理の中で面談記録（interview_details / work_histories）に入れる。
// step2〜3 では画面（InterviewForm の state → 自動保存）が入れていたが、ここに移した。入れ方の決まり（付録F）は変えていない:
//   - 欄が空のときだけ入れる／すでに違う値があれば入れずに「提案」（interview_script_answers.proposals）に残す
//   - メモ欄は空なら入れ、入っていれば末尾に「【スクリプト】」を付けて書き足す（同じ文があれば足さない）
//   - 押し直したとき、欄が前にスクリプトが入れた値のままなら差し替え、CA が手で直していたら触らない（applied で判定）
// 判定は apply.ts（decideApply）、計画は apply-plan.ts（planSceneApply / planAcceptProposal）。ここは DB の読み書きだけ。
//
// POST body（action で分ける）:
//   { action: "scene",   answers, sceneKey?, scriptVersion? } … answers を保存。sceneKey があればその場面の答えから欄に入れる
//                                                               （無ければ進み具合の保存だけ）
//   { action: "accept",  path }                             … 提案［替える］: その欄だけ提案の値にする
//   { action: "dismiss", path }                             … 提案［そのまま］: 提案から外すだけ
// 返り: { ok, applied, proposals, detail, workHistories, lastSavedAt, autosaveToken }
//   面談記録を書いたときは autosaveToken を進める（面談記録画面を別のセッションで開いていれば、既存の競合検知 409 で気づける）。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { SCRIPT_VERSION } from "@/lib/interview-script/script-v1";
import { runtimeSceneOfKey, sceneWritesWithClears } from "@/lib/interview-script/runtime";
import {
  detailMirrorOfWorkHistories,
  hasPlanWrites,
  planAcceptProposal,
  planDismissProposal,
  planSceneApply,
  type ApplyPlan,
  type ProposalMap,
} from "@/lib/interview-script/apply-plan";
import type { AnswerMap, AppliedMap } from "@/lib/interview-script/types";
// T-XXX step5B: 台本モードから面談詳細へ反映した希望条件（選択式）を履歴に残す（同じトランザクション）
import { PREFERENCE_ROUTES, loadInterviewDetailBaseline, recordInterviewDetailPreferenceChanges } from "@/lib/preference-history";

export const runtime = "nodejs";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type Body =
  | { action: "scene"; answers: unknown; sceneKey?: unknown; scriptVersion?: unknown }
  | { action: "accept"; path: unknown }
  | { action: "dismiss"; path: unknown };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !("action" in body)) return NextResponse.json({ error: "action を送ってください" }, { status: 400 });

  const record = await prisma.interviewRecord.findUnique({
    where: { id },
    include: { detail: true, workHistories: { orderBy: { order: "asc" } } },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const row = await prisma.interviewScriptAnswer.findUnique({ where: { interviewRecordId: id } });
  const applied: AppliedMap = isPlainObject(row?.applied) ? (row!.applied as AppliedMap) : {};
  const proposals: ProposalMap = isPlainObject(row?.proposals) ? (row!.proposals as ProposalMap) : {};
  const storedAnswers: AnswerMap = isPlainObject(row?.answers) ? (row!.answers as AnswerMap) : {};
  const detail = (record.detail ?? {}) as Record<string, unknown>;
  const rows = record.workHistories;

  let answers: AnswerMap = storedAnswers;
  let scriptVersion = row?.scriptVersion ?? SCRIPT_VERSION;
  let plan: ApplyPlan | null = null;
  let nextProposals: ProposalMap = proposals;

  if (body.action === "scene") {
    if (!isPlainObject(body.answers)) return NextResponse.json({ error: "answers はオブジェクトで送ってください" }, { status: 400 });
    answers = body.answers as AnswerMap;
    if (typeof body.scriptVersion === "string" && body.scriptVersion) scriptVersion = body.scriptVersion;
    if (typeof body.sceneKey === "string" && body.sceneKey) {
      const rs = runtimeSceneOfKey(body.sceneKey);
      if (!rs) return NextResponse.json({ error: `場面が見つかりません: ${body.sceneKey}` }, { status: 400 });
      const sa = answers[body.sceneKey] ?? {};
      plan = planSceneApply(sceneWritesWithClears(rs, sa), detail, rows, applied, proposals);
      nextProposals = plan.proposals;
    }
  } else if (body.action === "accept") {
    if (typeof body.path !== "string") return NextResponse.json({ error: "path を送ってください" }, { status: 400 });
    plan = planAcceptProposal(body.path, rows, applied, proposals);
    if (!plan) return NextResponse.json({ error: "その提案はもうありません" }, { status: 409 });
    nextProposals = plan.proposals;
  } else if (body.action === "dismiss") {
    if (typeof body.path !== "string") return NextResponse.json({ error: "path を送ってください" }, { status: 400 });
    nextProposals = planDismissProposal(body.path, proposals);
  } else {
    return NextResponse.json({ error: "action が不正です" }, { status: 400 });
  }

  const nextApplied = plan?.applied ?? applied;
  const writes = plan && hasPlanWrites(plan);
  const newToken = writes ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;

  await prisma.$transaction(async (tx) => {
    if (plan && writes) {
      // work_histories: 会社番号（order 順）の行を id で更新
      const touchedRows = rows.map((r, i) => (plan!.whPatches[i] ? { ...r, ...plan!.whPatches[i] } : r));
      for (const [idxStr, patch] of Object.entries(plan.whPatches)) {
        const target = rows[Number(idxStr)];
        if (!target) continue;
        await tx.workHistory.update({ where: { id: target.id }, data: patch });
      }
      // interview_details: スクリプトの欄 ＋（職歴を書いたときは）1社目の写し（自動保存と同じ列）
      const detailPatch: Record<string, unknown> = { ...plan.detailPatch };
      if (Object.keys(plan.whPatches).length > 0) Object.assign(detailPatch, detailMirrorOfWorkHistories(touchedRows));
      if (Object.keys(detailPatch).length > 0) {
        const baseline = await loadInterviewDetailBaseline(tx, { interviewRecordId: id, candidateId: record.candidateId });
        await tx.interviewDetail.upsert({
          where: { interviewRecordId: id },
          create: { interviewRecordId: id, ...(detailPatch as object) },
          update: detailPatch as object,
        });
        await recordInterviewDetailPreferenceChanges(tx, {
          candidateId: record.candidateId,
          interviewRecordId: id,
          baseline,
          patch: detailPatch,
          changedByUserId: user.id,
          route: PREFERENCE_ROUTES.scriptApply,
        });
      }
      await tx.interviewRecord.update({
        where: { id },
        data: { lastSavedAt: new Date(), autosaveToken: newToken!, lastEditedBy: user.id },
      });
    }
    await tx.interviewScriptAnswer.upsert({
      where: { interviewRecordId: id },
      create: {
        interviewRecordId: id,
        answers: answers as object,
        applied: nextApplied as object,
        proposals: nextProposals as object,
        scriptVersion,
        updatedByUserId: user.id,
      },
      update: {
        answers: answers as object,
        applied: nextApplied as object,
        proposals: nextProposals as object,
        scriptVersion,
        updatedByUserId: user.id,
      },
    });
  });

  const after = await prisma.interviewRecord.findUnique({
    where: { id },
    select: { lastSavedAt: true, autosaveToken: true, detail: true, workHistories: { orderBy: { order: "asc" } } },
  });
  return NextResponse.json({
    ok: true,
    applied: nextApplied,
    proposals: nextProposals,
    detail: after?.detail ?? null,
    workHistories: after?.workHistories ?? [],
    lastSavedAt: after?.lastSavedAt?.toISOString() ?? null,
    autosaveToken: after?.autosaveToken ?? null,
    wrote: !!writes,
  });
}

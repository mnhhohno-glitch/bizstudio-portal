// T-205: 面談準備チャットの「最初の整理」を作る（SSE）。
//
// 流れ:
//   1. 有効な部屋が無ければ、「面談」フォルダの最新 PDF（マイナビレジュメなど）を Drive から取得して pdf-parse で文字を取り出し、部屋を作る。
//      レジュメが無い／200字未満なら AI を呼ばず 422 を返す（部屋も作らない）。
//   2. 有効な部屋があり整理も済んでいれば 409（画面は状態取得で復元する）。整理が未保存（途中失敗）なら
//      保存済みの文字で作り直す（Drive も pdf-parse も呼ばない）。
//   3. body.rebuild=true は「作り直す」。文字を取り直してから古い部屋を非表示（archivedAt）にし、新しい部屋を作る。
//      取り直しに失敗したときは古い部屋を残す。
//   4. 整理を作る直前に「会社の下調べ」（ウェブ検索・research.ts）を1回行い、結果を部屋の research_json に保存する。
//      失敗（ウェブ検索が使えない・時間切れ・JSON が読めない）でも止めず、下調べなしで整理を作る。
//      「作り直す」は新しい部屋なので原則下調べからやり直す。ただし取り直したレジュメの文字が前の部屋と完全に同じで、
//      前の部屋の research_json の版が今の版（RESEARCH_VERSION）と同じなら、検索せずにその結果を新しい部屋にコピーする（step5）。
//      途中失敗の再送は、下調べ済みならその結果を使う（検索し直さない）。
//      step7: 学校の下調べはやめ、会社だけ。researchProgress は { company } だけを送る。
//      下調べ中・整理中は数秒おきに進み具合を送り続ける（無通信が長いと途中の中継で接続が切られるため）。
//   5. step8: 整理は文章のストリーミングではなく、ツール save_prep_summary の入力（決まった項目）で受け取る。
//      検証に通らなければ1回だけ作り直し、それでも駄目ならエラー（画面は「再送」を出す）。
//      通ったら assistant の発言（kind=SUMMARY・本文は formatPrepSummaryText の文章）と、部屋の summary_json・career_type を保存し、
//      done で summary_json を画面に渡す（画面はカードに組み立てて一度に表示する）。
//      途中で失敗したら何も保存しない。
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { findLatestMeetingPdf, extractResumeText } from "@/lib/interview-prep/resume";
import {
  INTERVIEW_PREP_MODEL,
  buildPrepSystem,
  buildSummaryMessages,
  callSummaryTool,
} from "@/lib/interview-prep/chat";
import { sseResponse } from "@/lib/interview-prep/sse";
import { runResearch, recordResearchUsage, toPartStatus } from "@/lib/interview-prep/research";
import { reusableResearch, type ResearchPartStatus, type ResearchResult } from "@/lib/interview-prep/research-format";
import { careerTypeForRoom, formatPrepSummaryText, type PrepSummary } from "@/lib/interview-prep/summary-format";

/** 下調べ中・整理中に進み具合を送る間隔（ms）。 */
const PROGRESS_INTERVAL_MS = 3_000;
/** 整理の検証に通らなかったときの作り直し回数。 */
const SUMMARY_RETRIES = 1;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const { candidateId } = await params;
  const body = (await req.json().catch(() => ({}))) as { rebuild?: boolean };
  const rebuild = body.rebuild === true;

  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!candidate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const active = await prisma.interviewPrepRoom.findFirst({
    where: { candidateId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, resumeText: true, summaryMessageId: true, researchJson: true },
  });

  let roomId: string;
  let resumeText: string;
  // 下調べの使い回し元（再送は今の部屋・作り直しは前の部屋）。使えるかは reusableResearch で決める
  let reuseSource: { resumeText: string | null; researchJson: unknown } | null = null;

  if (active && !rebuild) {
    if (active.summaryMessageId) {
      return NextResponse.json({ error: "already_summarized", roomId: active.id }, { status: 409 });
    }
    if (active.resumeText && active.resumeText.length > 0) {
      // 途中失敗の再送: 保存済みの文字で作り直す
      roomId = active.id;
      resumeText = active.resumeText;
      reuseSource = active;
    } else {
      // 文字が無い部屋（想定外）は非表示にして作り直す
      await prisma.interviewPrepRoom.update({ where: { id: active.id }, data: { archivedAt: new Date() } });
      const created = await createRoomWithResume(candidateId, actor.id);
      if (!created.ok) return created.response;
      roomId = created.roomId;
      resumeText = created.resumeText;
    }
  } else {
    const created = await createRoomWithResume(candidateId, actor.id, active?.id ?? null);
    if (!created.ok) return created.response;
    roomId = created.roomId;
    resumeText = created.resumeText;
    // step5〜7: 作り直しで文字も版も同じなら、前の部屋の下調べを使い回す
    if (rebuild) reuseSource = active;
  }

  const messages = buildSummaryMessages();

  return sseResponse(async (send) => {
    send({ started: true, roomId });

    // 下調べ（失敗しても止めない）
    const reused = reusableResearch(reuseSource, resumeText);
    let research: ResearchResult;
    if (reused) {
      research = reused;
      console.log("[interview-prep research] reused from previous room (same resume text and version)");
    } else {
      const progress: { company: "running" | ResearchPartStatus } = { company: "running" };
      send({ researching: true, researchProgress: { ...progress } });
      const timer = setInterval(() => send({ researchProgress: { ...progress } }), PROGRESS_INTERVAL_MS);
      let outcome: Awaited<ReturnType<typeof runResearch>>;
      try {
        outcome = await runResearch(resumeText);
      } finally {
        clearInterval(timer);
      }
      progress.company = toPartStatus(outcome.status);
      send({ researchProgress: { ...progress } });
      research = outcome.research;
      await recordResearchUsage(outcome, candidateId, rebuild);
      console.log(
        `[interview-prep research] status=${outcome.status} searches=${outcome.webSearchRequests} input=${outcome.usage?.input_tokens ?? 0} output=${outcome.usage?.output_tokens ?? 0} official_urls=${outcome.officialUrlKept}/${outcome.officialUrlProposed} latency_ms=${outcome.latencyMs}`,
      );
      if (outcome.status === "web_search_disabled") {
        console.warn(`[interview-prep research] web search is disabled for this organization: ${outcome.errorMessage}`);
      } else if (outcome.status !== "ok") {
        console.warn(`[interview-prep research] failed: ${outcome.status} ${outcome.errorStatus ?? ""} ${outcome.errorMessage ?? ""}`);
      }
    }
    try {
      // 失敗も状態付きで保存する（再送・作り直しでは ok のときだけ使い回し、失敗なら調べ直す）
      await prisma.interviewPrepRoom.update({
        where: { id: roomId },
        data: { researchJson: research as unknown as Prisma.InputJsonValue, researchedAt: new Date() },
      });
    } catch (e) {
      console.error("[interview-prep research] save failed:", e);
    }
    send({ researched: true, research });

    // 整理（ツール呼び出し）。進み具合は数秒おきに送る
    const system = buildPrepSystem(resumeText, research);
    send({ summarizing: true });
    const summarizingTimer = setInterval(() => send({ summarizing: true }), PROGRESS_INTERVAL_MS);
    const startedAt = Date.now();
    try {
      let summary: PrepSummary | null = null;
      for (let attempt = 0; attempt <= SUMMARY_RETRIES && !summary; attempt++) {
        const callStartedAt = Date.now();
        const result = await callSummaryTool({ system, messages });
        const latencyMs = Date.now() - callStartedAt;
        const noteParts = [rebuild ? "rebuild" : null, attempt > 0 ? "retry" : null, result.invalidReason ? `invalid-${result.invalidReason}` : null];
        await recordAdvisorUsage({
          endpoint: "interview-prep-summary",
          model: INTERVIEW_PREP_MODEL,
          usage: result.usage,
          candidateId,
          latencyMs,
          note: noteParts.filter(Boolean).join("; ") || null,
        });
        const u = result.usage;
        console.log(
          `[interview-prep summary] attempt=${attempt} valid=${result.summary ? "yes" : `no(${result.invalidReason})`} stop=${result.stopReason} input=${u.input_tokens} output=${u.output_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} latency_ms=${latencyMs}`,
        );
        summary = result.summary;
      }
      clearInterval(summarizingTimer);
      if (!summary) {
        send({ error: "整理の形が読めませんでした。再送してください。" });
        return;
      }
      const text = formatPrepSummaryText(summary);
      const careerType = careerTypeForRoom(summary);
      const saved = await prisma.$transaction(async (tx) => {
        const msg = await tx.interviewPrepMessage.create({
          data: { roomId, role: "assistant", content: text, kind: "SUMMARY" },
          select: { id: true, content: true, createdAt: true },
        });
        await tx.interviewPrepRoom.update({
          where: { id: roomId },
          data: {
            summaryMessageId: msg.id,
            careerType,
            summaryJson: summary as unknown as Prisma.InputJsonValue,
            askedQuestions: Prisma.DbNull,
          },
        });
        return msg;
      });
      send({ done: true, roomId, summary: saved, summaryJson: summary, askedQuestions: {}, careerType, research });
    } catch (e) {
      clearInterval(summarizingTimer);
      console.error("[interview-prep summary] failed:", e);
      const status = (e as { status?: number })?.status;
      await recordAdvisorUsage({
        endpoint: "interview-prep-summary",
        model: INTERVIEW_PREP_MODEL,
        usage: null,
        candidateId,
        latencyMs: Date.now() - startedAt,
        note: `error-${status ?? "unknown"}`,
      });
      send({
        error:
          status === 429
            ? "APIのレート制限に達しました。少し待ってから再送してください。"
            : "AI の応答取得に失敗しました。再送してください。",
      });
    }
  });
}

type CreateResult =
  | { ok: true; roomId: string; resumeText: string }
  | { ok: false; response: NextResponse };

/** レジュメの文字を取り出して部屋を作る。archivePreviousId を渡すと、取り出し成功後にその部屋を非表示にする。 */
async function createRoomWithResume(
  candidateId: string,
  userId: string,
  archivePreviousId: string | null = null,
): Promise<CreateResult> {
  const file = await findLatestMeetingPdf(candidateId);
  if (!file) {
    return { ok: false, response: NextResponse.json({ error: "no_resume" }, { status: 422 }) };
  }
  const extracted = await extractResumeText(file);
  if (!extracted.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "resume_unreadable", reason: extracted.reason, chars: extracted.chars }, { status: 422 }),
    };
  }
  const now = new Date();
  const room = await prisma.$transaction(async (tx) => {
    if (archivePreviousId) {
      await tx.interviewPrepRoom.updateMany({
        where: { candidateId, archivedAt: null },
        data: { archivedAt: now },
      });
    }
    return tx.interviewPrepRoom.create({
      data: {
        candidateId,
        createdByUserId: userId,
        resumeFileId: file.id,
        resumeText: extracted.text,
        resumeImportedAt: file.createdAt,
        resumeExtractedAt: now,
      },
      select: { id: true },
    });
  });
  return { ok: true, roomId: room.id, resumeText: extracted.text };
}

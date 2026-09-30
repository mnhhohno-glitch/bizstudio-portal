// T-208 step2: 初回面談の面談スクリプトの答え（interview_script_answers）の読み書き。
// 認証は既存の面談 API（/api/interviews/[id]）と同じ getSessionUser()（未ログイン 403）。
//
// GET  … { answers, applied, proposals, scriptVersion, updatedAt } を返す。まだ無ければ answers/applied/proposals は {}（scriptVersion は null）。
// PUT  … { answers, scriptVersion } を保存（upsert）。T-208 step4 から applied / proposals はサーバー側（…/script-answers/apply）が
//         面談記録に入れるときに更新するので、PUT では answers だけを書く（applied が来ても無視する）。
//         面談記録の欄への反映は POST …/script-answers/apply（apply/route.ts）。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { SCRIPT_VERSION } from "@/lib/interview-script/script-v1";

export const runtime = "nodejs";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const record = await prisma.interviewRecord.findUnique({ where: { id }, select: { id: true } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const row = await prisma.interviewScriptAnswer.findUnique({ where: { interviewRecordId: id } });
  return NextResponse.json({
    answers: isPlainObject(row?.answers) ? row!.answers : {},
    applied: isPlainObject(row?.applied) ? row!.applied : {},
    proposals: isPlainObject(row?.proposals) ? row!.proposals : {},
    scriptVersion: row?.scriptVersion ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { answers?: unknown; scriptVersion?: unknown } | null;
  if (!body || !isPlainObject(body.answers)) {
    return NextResponse.json({ error: "answers はオブジェクトで送ってください" }, { status: 400 });
  }
  const scriptVersion = typeof body.scriptVersion === "string" && body.scriptVersion ? body.scriptVersion : SCRIPT_VERSION;

  const record = await prisma.interviewRecord.findUnique({ where: { id }, select: { id: true } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const row = await prisma.interviewScriptAnswer.upsert({
    where: { interviewRecordId: id },
    create: {
      interviewRecordId: id,
      answers: body.answers as object,
      applied: {},
      proposals: {},
      scriptVersion,
      updatedByUserId: user.id,
    },
    update: {
      answers: body.answers as object,
      scriptVersion,
      updatedByUserId: user.id,
    },
    select: { updatedAt: true, scriptVersion: true },
  });
  return NextResponse.json({ ok: true, scriptVersion: row.scriptVersion, updatedAt: row.updatedAt.toISOString() });
}

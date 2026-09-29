// T-208 step2: 初回面談の台本モードの答え（interview_script_answers）の読み書き。
// 認証は既存の面談 API（/api/interviews/[id]）と同じ getSessionUser()（未ログイン 403）。
//
// GET  … { answers, applied, scriptVersion, updatedAt } を返す。まだ無ければ answers/applied は {}（scriptVersion は null）。
// PUT  … { answers, applied, scriptVersion } を丸ごと保存（upsert）。入力画面の欄はここでは書き換えない
//         （欄への反映は画面の state → 既存の自動保存で行う。サーバーで detail を直接書かない）。
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
    scriptVersion: row?.scriptVersion ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { answers?: unknown; applied?: unknown; scriptVersion?: unknown }
    | null;
  if (!body || !isPlainObject(body.answers) || !isPlainObject(body.applied)) {
    return NextResponse.json({ error: "answers と applied はオブジェクトで送ってください" }, { status: 400 });
  }
  const scriptVersion = typeof body.scriptVersion === "string" && body.scriptVersion ? body.scriptVersion : SCRIPT_VERSION;

  const record = await prisma.interviewRecord.findUnique({ where: { id }, select: { id: true } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const row = await prisma.interviewScriptAnswer.upsert({
    where: { interviewRecordId: id },
    create: {
      interviewRecordId: id,
      answers: body.answers as object,
      applied: body.applied as object,
      scriptVersion,
      updatedByUserId: user.id,
    },
    update: {
      answers: body.answers as object,
      applied: body.applied as object,
      scriptVersion,
      updatedByUserId: user.id,
    },
    select: { updatedAt: true, scriptVersion: true },
  });
  return NextResponse.json({ ok: true, scriptVersion: row.scriptVersion, updatedAt: row.updatedAt.toISOString() });
}

// T-205 step8: 面談で「聞いた」質問の記録（interview_prep_rooms.asked_questions）。
// body: { index: number, asked: boolean }。index は summary_json.questions の添字。
// 押すと記録、もう一度押すと外す。整理が summary_json で保存された部屋（step8 以降）だけ受け付ける。
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  normalizeAskedQuestions,
  normalizePrepSummary,
  toggleAskedQuestion,
} from "@/lib/interview-prep/summary-format";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = (await req.json().catch(() => ({}))) as { index?: unknown; asked?: unknown };
  const index = typeof body.index === "number" ? body.index : NaN;
  const asked = body.asked === true;
  if (!Number.isInteger(index) || index < 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const room = await prisma.interviewPrepRoom.findFirst({
    where: { candidateId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true, askedQuestions: true },
  });
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const summary = normalizePrepSummary(room.summaryJson);
  if (!summary) return NextResponse.json({ error: "not_card_format" }, { status: 409 });
  if (index >= summary.questions.length) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const next = toggleAskedQuestion(
    normalizeAskedQuestions(room.askedQuestions),
    index,
    asked,
    actor.id,
    new Date(),
    summary.questions.length,
  );
  await prisma.interviewPrepRoom.update({
    where: { id: room.id },
    data: { askedQuestions: next as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ askedQuestions: next });
}

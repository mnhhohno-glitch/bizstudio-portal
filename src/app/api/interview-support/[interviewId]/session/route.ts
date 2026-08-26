// T-183 Phase 2: 面談サポートセッションの保存API。
// - クライアント生成の sessionId を主キーとした upsert（丸ごと上書き）。1分ごとの定期保存が
//   何度走っても重複レコードにならない（冪等）。
// - transcript / explanations / endedAt は毎回全量で上書きする（部分マージはしない）。
//   停止→再開したセッションでは endedAt を null に戻す必要があるため、endedAt 未指定は null として扱う。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

type SaveBody = {
  sessionId?: string;
  startedAt?: string;
  endedAt?: string | null;
  transcript?: unknown;
  explanations?: unknown;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { interviewId } = await params;
  const body = (await req.json()) as SaveBody;

  const sessionId = (body.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  const startedAt = body.startedAt ? new Date(body.startedAt) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "startedAt is required" }, { status: 400 });
  }
  const endedAt = body.endedAt ? new Date(body.endedAt) : null;
  if (endedAt && Number.isNaN(endedAt.getTime())) {
    return NextResponse.json({ error: "endedAt が不正です" }, { status: 400 });
  }
  if (!Array.isArray(body.transcript) || !Array.isArray(body.explanations)) {
    return NextResponse.json({ error: "transcript / explanations は配列で指定してください" }, { status: 400 });
  }

  const record = await prisma.interviewRecord.findUnique({
    where: { id: interviewId },
    select: { id: true },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const transcript = body.transcript as Prisma.InputJsonValue;
  const explanations = body.explanations as Prisma.InputJsonValue;

  const session = await prisma.interviewSupportSession.upsert({
    where: { id: sessionId },
    create: {
      id: sessionId,
      interviewRecordId: interviewId,
      createdByUserId: user.id,
      startedAt,
      endedAt,
      transcript,
      explanations,
    },
    update: {
      endedAt,
      transcript,
      explanations,
    },
  });

  return NextResponse.json({ sessionId: session.id, updatedAt: session.updatedAt });
}

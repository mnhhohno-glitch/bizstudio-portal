// T-183 Phase 2: 面談サポートセッションの内容取得・削除API。
// - GET: 行クリックでの振り返り表示用（transcript / explanations 全量）。
// - DELETE: セッション単位の削除。当該セッションのみ消え、面談レコード・他データには影響しない。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;
  const session = await prisma.interviewSupportSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      transcript: true,
      explanations: true,
      interviewRecord: { select: { id: true, interviewCount: true, interviewDate: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ session });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;
  const existing = await prisma.interviewSupportSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.interviewSupportSession.delete({ where: { id: sessionId } });
  return NextResponse.json({ success: true });
}

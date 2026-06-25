import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ candidateId: string }> };

const METHODS = new Set(["TEL", "MESSAGE"]);

// T-111: 連絡記録（contactedAt desc）。notes/route.ts と同型。
export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const logs = await prisma.contactLog.findMany({
    where: { candidateId },
    orderBy: { contactedAt: "desc" },
    include: {
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ logs });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { method, content } = body;

  if (!method || !METHODS.has(method)) {
    return NextResponse.json({ error: "連絡手段を選択してください（TEL / MESSAGE）" }, { status: 400 });
  }
  if (!content || typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "連絡内容を入力してください" }, { status: 400 });
  }

  const log = await prisma.contactLog.create({
    data: {
      candidateId,
      method,
      content: content.trim(),
      contactedAt: new Date(), // 現在時刻（UTC保存・表示時JST）
      authorUserId: user.id,
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ log }, { status: 201 });
}

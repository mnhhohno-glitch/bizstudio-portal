import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memoId: string }> }
) {
  const { memoId } = await params;
  const body = await req.json();

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.flag !== undefined) updateData.flag = body.flag;
  if (body.date !== undefined) updateData.date = new Date(body.date);
  if (body.time !== undefined) updateData.time = body.time;
  if (body.content !== undefined) updateData.content = body.content;

  try {
    const memo = await prisma.interviewMemo.update({
      where: { id: memoId },
      data: updateData,
    });
    return NextResponse.json(memo);
  } catch {
    return NextResponse.json({ error: "Memo not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memoId: string }> }
) {
  const { memoId } = await params;

  try {
    await prisma.interviewMemo.delete({ where: { id: memoId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Memo not found" }, { status: 404 });
  }
}

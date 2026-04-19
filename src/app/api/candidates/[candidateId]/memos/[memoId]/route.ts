import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; memoId: string }> }
) {
  const { memoId } = await params;
  const body = await req.json();

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.content !== undefined) updateData.content = body.content;

  try {
    const memo = await prisma.candidateMemo.update({
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
  { params }: { params: Promise<{ candidateId: string; memoId: string }> }
) {
  const { memoId } = await params;

  try {
    await prisma.candidateMemo.delete({ where: { id: memoId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Memo not found" }, { status: 404 });
  }
}

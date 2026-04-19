import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const memos = await prisma.interviewMemo.findMany({
    where: { interviewRecordId: id },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(memos);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const record = await prisma.interviewRecord.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!record) {
    return NextResponse.json(
      { error: "Interview record not found" },
      { status: 404 }
    );
  }

  const memo = await prisma.interviewMemo.create({
    data: {
      interviewRecordId: id,
      title: body.title || "",
      flag: body.flag || "その他",
      date: body.date ? new Date(body.date) : new Date(),
      time: body.time || null,
      content: body.content || "",
    },
  });

  return NextResponse.json(memo, { status: 201 });
}

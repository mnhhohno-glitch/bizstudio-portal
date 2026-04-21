import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; whId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, whId } = await params;
  const body = await req.json();

  const existing = await prisma.workHistory.findFirst({
    where: { id: whId, interviewRecordId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await prisma.workHistory.update({
    where: { id: whId },
    data: {
      order: body.order,
      companyName: body.companyName ?? null,
      businessContent: body.businessContent ?? null,
      tenureYear: body.tenureYear ?? null,
      tenureMonth: body.tenureMonth ?? null,
      jobTypeFlag: body.jobTypeFlag ?? null,
      jobTypeMemo: body.jobTypeMemo ?? null,
      resignReasonLarge: body.resignReasonLarge ?? null,
      resignReasonMedium: body.resignReasonMedium ?? null,
      resignReasonSmall: body.resignReasonSmall ?? null,
      jobChangeReasonMemo: body.jobChangeReasonMemo ?? null,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; whId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, whId } = await params;

  const existing = await prisma.workHistory.findFirst({
    where: { id: whId, interviewRecordId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.workHistory.delete({ where: { id: whId } });
  return NextResponse.json({ ok: true });
}

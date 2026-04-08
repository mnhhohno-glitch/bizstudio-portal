import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const record = await prisma.interviewRecord.findUnique({
    where: { id },
    include: {
      detail: true,
      rating: true,
      candidate: { select: { id: true, name: true, candidateNumber: true } },
      interviewer: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ record });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { detail, rating, ...recordFields } = body;

  // duration再計算
  if (recordFields.startTime && recordFields.endTime) {
    const [sh, sm] = recordFields.startTime.split(":").map(Number);
    const [eh, em] = recordFields.endTime.split(":").map(Number);
    const d = (eh * 60 + em) - (sh * 60 + sm);
    recordFields.duration = d >= 0 ? d : null;
  }

  if (recordFields.interviewDate) {
    recordFields.interviewDate = new Date(recordFields.interviewDate);
  }

  const record = await prisma.interviewRecord.update({
    where: { id },
    data: {
      ...recordFields,
      detail: detail ? {
        upsert: { create: detail, update: detail },
      } : undefined,
      rating: rating ? {
        upsert: { create: rating, update: rating },
      } : undefined,
    },
    include: {
      detail: true,
      rating: true,
      candidate: { select: { id: true, name: true, candidateNumber: true } },
      interviewer: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ record });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.interviewRecord.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

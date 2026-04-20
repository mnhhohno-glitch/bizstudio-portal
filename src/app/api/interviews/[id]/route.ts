import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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
      memos: { orderBy: { date: "desc" } },
      attachments: { orderBy: { uploadedAt: "desc" } },
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

  if (recordFields.status === "complete") {
    recordFields.lastSavedAt = new Date();
  }

  // isLatest は自動管理のため手動変更を除外
  delete recordFields.isLatest;

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
      memos: { orderBy: { date: "desc" } },
      attachments: { orderBy: { uploadedAt: "desc" } },
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

  const attachments = await prisma.interviewAttachment.findMany({
    where: { interviewRecordId: id },
    select: { filePath: true },
  });
  if (attachments.length > 0) {
    const paths = attachments.map((a) => a.filePath);
    await supabase.storage.from("interview-attachments").remove(paths);
  }

  const deleted = await prisma.interviewRecord.delete({
    where: { id },
    select: { candidateId: true },
  });

  const latestRemaining = await prisma.interviewRecord.findFirst({
    where: { candidateId: deleted.candidateId },
    orderBy: { interviewDate: "desc" },
    select: { id: true },
  });
  if (latestRemaining) {
    await prisma.interviewRecord.update({
      where: { id: latestRemaining.id },
      data: { isLatest: true },
    });
  }

  return NextResponse.json({ success: true });
}

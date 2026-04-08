import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    candidateId, interviewDate, startTime, endTime, interviewTool,
    interviewerUserId, interviewType, resultFlag, interviewMemo,
    rawTranscript, resumePdfFileId, summaryText,
    detail, rating,
  } = body;

  if (!candidateId || !interviewDate || !startTime || !endTime || !interviewTool || !interviewerUserId || !interviewType) {
    return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
  }

  // 面談回数カウント
  const existingCount = await prisma.interviewRecord.count({ where: { candidateId } });
  const interviewCount = existingCount + 1;

  // 前回面談メモ取得
  const lastRecord = await prisma.interviewRecord.findFirst({
    where: { candidateId },
    orderBy: { interviewDate: "desc" },
    select: { interviewMemo: true },
  });

  // duration計算
  let duration: number | null = null;
  if (startTime && endTime) {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    duration = (eh * 60 + em) - (sh * 60 + sm);
    if (duration < 0) duration = null;
  }

  // Employee取得
  const employee = await prisma.employee.findFirst({ where: { userId: user.id } });
  if (!employee) return NextResponse.json({ error: "従業員情報が見つかりません" }, { status: 400 });

  const record = await prisma.interviewRecord.create({
    data: {
      candidateId,
      interviewDate: new Date(interviewDate),
      startTime,
      endTime,
      duration,
      interviewTool,
      interviewerUserId,
      interviewType,
      interviewCount,
      resultFlag: resultFlag || null,
      interviewMemo: interviewMemo || null,
      previousMemo: lastRecord?.interviewMemo || null,
      rawTranscript: rawTranscript || null,
      resumePdfFileId: resumePdfFileId || null,
      summaryText: summaryText || null,
      createdByUserId: employee.id,
      detail: detail ? { create: detail } : undefined,
      rating: rating ? { create: rating } : undefined,
    },
    include: { detail: true, rating: true, candidate: { select: { name: true, candidateNumber: true } } },
  });

  return NextResponse.json({ record });
}

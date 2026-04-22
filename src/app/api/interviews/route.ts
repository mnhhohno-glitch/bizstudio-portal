import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 30));
  const sortBy = sp.get("sortBy") || "interviewDate";
  const sortOrder = (sp.get("sortOrder") || "desc") as "asc" | "desc";
  const rcName = sp.get("rcName")?.trim() || "";
  const caName = sp.get("caName")?.trim() || "";
  const dateFrom = sp.get("dateFrom") || "";
  const dateTo = sp.get("dateTo") || "";
  const candidateName = sp.get("candidateName")?.trim() || "";
  const search = sp.get("search")?.trim() || "";

  const where: Prisma.InterviewRecordWhereInput = {};
  const andClauses: Prisma.InterviewRecordWhereInput[] = [];

  if (rcName) {
    andClauses.push({ interviewer: { name: { contains: rcName } } });
  }
  if (caName) {
    andClauses.push({ candidate: { employee: { name: { contains: caName } } } });
  }
  if (dateFrom) {
    andClauses.push({ interviewDate: { gte: new Date(dateFrom) } });
  }
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    andClauses.push({ interviewDate: { lte: end } });
  }
  if (candidateName) {
    andClauses.push({ candidate: { name: { contains: candidateName } } });
  }
  if (search) {
    andClauses.push({
      OR: [
        { candidate: { name: { contains: search } } },
        { candidate: { candidateNumber: { contains: search } } },
        { candidate: { phone: { contains: search } } },
        { interviewer: { name: { contains: search } } },
        { candidate: { employee: { name: { contains: search } } } },
      ],
    });
  }
  if (andClauses.length > 0) where.AND = andClauses;

  const orderByMap: Record<string, Prisma.InterviewRecordOrderByWithRelationInput> = {
    interviewDate: { interviewDate: sortOrder },
    rcName: { interviewer: { name: sortOrder } },
    caName: { candidate: { employee: { name: sortOrder } } },
    startTime: { startTime: sortOrder },
    interviewCount: { interviewCount: sortOrder },
    candidateName: { candidate: { name: sortOrder } },
    age: { candidate: { birthday: sortOrder === "asc" ? "desc" : "asc" } },
    desiredPrefecture: { detail: { desiredPrefecture: sortOrder } },
  };
  const orderBy = orderByMap[sortBy] || { interviewDate: "desc" };

  const [interviews, total] = await Promise.all([
    prisma.interviewRecord.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        interviewDate: true,
        startTime: true,
        endTime: true,
        interviewTool: true,
        interviewType: true,
        interviewCount: true,
        resultFlag: true,
        status: true,
        candidate: {
          select: {
            id: true,
            candidateNumber: true,
            name: true,
            gender: true,
            birthday: true,
            phone: true,
            email: true,
            address: true,
            employee: { select: { id: true, employeeNumber: true, name: true } },
          },
        },
        interviewer: { select: { id: true, employeeNumber: true, name: true } },
        detail: { select: { jobChangeTimeline: true, desiredPrefecture: true, desiredJobType1: true } },
        rating: { select: { overallRank: true } },
      },
    }),
    prisma.interviewRecord.count({ where }),
  ]);

  const serialized = interviews.map((r) => ({
    ...r,
    interviewDate: r.interviewDate.toISOString(),
    candidateBirthday: r.candidate.birthday?.toISOString() ?? null,
  }));

  return NextResponse.json({ interviews: serialized, total, page, pageSize });
}

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

  if (!candidateId || !interviewDate || !startTime || !interviewTool || !interviewerUserId || !interviewType) {
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
      status: body.status ?? "draft",
      isLatest: true,
      detail: detail ? { create: detail } : undefined,
      rating: rating ? { create: rating } : undefined,
    },
    include: {
      detail: true,
      rating: true,
      memos: true,
      attachments: true,
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
  });

  await prisma.interviewRecord.updateMany({
    where: {
      candidateId,
      id: { not: record.id },
      isLatest: true,
    },
    data: { isLatest: false },
  });

  if (interviewCount === 1) {
    await copyCandidateFilesToInterview(candidateId, record.id);
    const freshRecord = await prisma.interviewRecord.findUnique({
      where: { id: record.id },
      include: {
        detail: true,
        rating: true,
        memos: true,
        attachments: true,
        candidate: { select: { id: true, name: true, candidateNumber: true } },
      },
    });
    if (freshRecord) return NextResponse.json({ record: freshRecord });
  }

  return NextResponse.json({ record });
}

const ATTACHMENT_BUCKET = "interview-attachments";

async function copyCandidateFilesToInterview(
  candidateId: string,
  interviewId: string,
): Promise<void> {
  try {
    const files = await prisma.candidateFile.findMany({
      where: {
        candidateId,
        category: { in: ["ORIGINAL", "MEETING"] },
        mimeType: "application/pdf",
      },
      orderBy: { createdAt: "desc" },
    });

    if (files.length === 0) {
      console.log(`[auto-attach] No PDF files found for candidate ${candidateId}`);
      return;
    }

    console.log(`[auto-attach] Copying ${files.length} PDF(s) for candidate ${candidateId}`);

    for (const file of files) {
      try {
        const { base64, mimeType } = await downloadFileFromDrive(file.driveFileId);
        const buffer = Buffer.from(base64, "base64");

        const ext = (file.fileName.split(".").pop() || "pdf").replace(/[^a-zA-Z0-9]/g, "");
        const storagePath = `interviews/${interviewId}/${randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(storagePath, buffer, {
            contentType: mimeType || file.mimeType,
            upsert: false,
          });

        if (uploadError) {
          console.error(`[auto-attach] Upload failed for ${file.fileName}:`, uploadError);
          continue;
        }

        await prisma.interviewAttachment.create({
          data: {
            interviewRecordId: interviewId,
            fileName: file.fileName,
            fileType: ext.toLowerCase(),
            filePath: storagePath,
            fileSize: file.fileSize,
            mimeType: mimeType || file.mimeType,
            uploadedBy: "auto-attach",
          },
        });

        console.log(`[auto-attach] Copied ${file.fileName} → ${storagePath}`);
      } catch (e) {
        console.error(`[auto-attach] Error copying ${file.fileName}:`, e);
      }
    }
  } catch (e) {
    console.error(`[auto-attach] Unexpected error:`, e);
  }
}

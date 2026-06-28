import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";
import { checkInputMissing } from "@/lib/interview-input-missing";
import { applyLatestInterviewResultToSupportStatus } from "@/lib/interview-result-to-status";
import { formatRecruiterName, normalizeRecruiterName } from "@/lib/recruiterDisplay";

const TERMINATED_RESULTS = ["連絡なし辞退", "連絡あり辞退", "支援終了_当社判断", "支援終了_本人希望"];

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

  // T-102追補: 担当RC（rcName）の絞り込みは「号機→実名変換後の表示値」に対して行う。
  // Prisma の where では JS 変換（formatRecruiterName）を表現できないため、ここでは
  // where に積まず、下の rcName 専用パスで取得後に JS 側で突合する。
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
        { candidate: { nameKana: { contains: search } } },
        { candidate: { candidateNumber: { contains: search } } },
        { candidate: { phone: { contains: search } } },
        { candidate: { email: { contains: search } } },
      ],
    });
  }
  if (andClauses.length > 0) where.AND = andClauses;

  const orderByMap: Record<string, Prisma.InterviewRecordOrderByWithRelationInput | Prisma.InterviewRecordOrderByWithRelationInput[]> = {
    interviewDate: [{ interviewDate: sortOrder }, { startTime: "asc" }],
    rcName: { interviewer: { name: sortOrder } },
    caName: { candidate: { employee: { name: sortOrder } } },
    startTime: { startTime: sortOrder },
    interviewCount: { interviewCount: sortOrder },
    candidateName: { candidate: { name: sortOrder } },
    age: { candidate: { birthday: sortOrder === "asc" ? "desc" : "asc" } },
    desiredPrefecture: { detail: { desiredPrefecture: sortOrder } },
  };
  const orderBy = orderByMap[sortBy] || [{ interviewDate: "desc" }, { startTime: "asc" }];

  const interviewSelect = {
        id: true,
        interviewDate: true,
        startTime: true,
        endTime: true,
        interviewTool: true,
        interviewType: true,
        interviewCount: true,
        resultFlag: true,
        interviewMemo: true,
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
            // T-101: スカウト応募の応募日 / 配信日 / 媒体（一覧表示・検索用）
            applicationDate: true,
            scoutDeliveryDate: true,
            mediaSource: true,
            // T-102: 担当RC＝スカウト配信担当（号機表記は表示時に実名変換）
            recruiterName: true,
            employee: { select: { id: true, employeeNumber: true, name: true } },
          },
        },
        interviewer: { select: { id: true, employeeNumber: true, name: true } },
        // T-046: pull all the fields we need for input-missing detection.
        // The list view itself only renders a subset, but the extra columns
        // are needed by `checkInputMissing` to compute `hasInputMissing`.
        detail: {
          select: {
            jobChangeTimeline: true,
            desiredPrefecture: true,
            desiredJobType1: true,
            agentUsageFlag: true,
            activityPeriod: true,
            applicationTypeFlag: true,
            currentApplicationCount: true,
            educationFlag: true,
            graduationDate: true,
            graduationStatus: true,
            desiredJobTypes: true,
            desiredIndustries: true,
            desiredAreas: true,
            currentSalary: true,
            desiredSalaryMin: true,
            desiredSalaryMax: true,
            desiredDayOff: true,
            desiredOvertimeMax: true,
            desiredTransfer: true,
            driverLicenseFlag: true,
            languageSkillFlag: true,
            japaneseSkillFlag: true,
            typingFlag: true,
            excelFlag: true,
            wordFlag: true,
            pptFlag: true,
            documentStatusFlag: true,
            documentSupportFlag: true,
            contactMethod: true,
            jobReferralFlag: true,
            nextInterviewFlag: true,
            nextInterviewDate: true,
            nextInterviewTime: true,
            nextInterviewMemo: true,
            nextAction: true,
            freeMemo: true,
            initialSummary: true,
          },
        },
        rating: {
          select: {
            overallRank: true,
            personalityMotivation: true,
            personalityCommunication: true,
            personalityManner: true,
            personalityIntelligence: true,
            personalityHumanity: true,
            careerJobType: true,
            careerExperience: true,
            careerJobChangeCount: true,
            careerAchievement: true,
            careerQualification: true,
            conditionJobType: true,
            conditionSalary: true,
            conditionHoliday: true,
            conditionArea: true,
            conditionFlexibility: true,
          },
        },
        _count: { select: { workHistories: true } },
  } satisfies Prisma.InterviewRecordSelect;

  type InterviewRow = Prisma.InterviewRecordGetPayload<{ select: typeof interviewSelect }>;

  // 担当RC（rcName）の絞り込み・ソートは「号機→実名変換後の表示値」基準。表示と完全一致させる。
  const rcFilterActive = rcName.length > 0;
  const rcSortActive = sortBy === "rcName";

  let interviews: InterviewRow[];
  let total: number;

  if (rcFilterActive || rcSortActive) {
    // where（rcName 以外の既存条件）に一致する全行を取得し、JS 側で表示値ベースに
    // 絞り込み → ソート → ページングする。formatRecruiterName を表示と共有するため乖離しない。
    const all = await prisma.interviewRecord.findMany({ where, orderBy, select: interviewSelect });
    let rows = all;
    if (rcFilterActive) {
      const q = normalizeRecruiterName(rcName);
      rows = rows.filter((r) =>
        normalizeRecruiterName(formatRecruiterName(r.candidate.recruiterName)).includes(q),
      );
    }
    if (rcSortActive) {
      rows = [...rows].sort((a, b) => {
        const an = formatRecruiterName(a.candidate.recruiterName).trim();
        const bn = formatRecruiterName(b.candidate.recruiterName).trim();
        // 空（一覧では「-」）は昇順・降順に関わらず末尾へ
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        const cmp = an.localeCompare(bn, "ja");
        return sortOrder === "asc" ? cmp : -cmp;
      });
    }
    total = rows.length;
    interviews = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  } else {
    [interviews, total] = await Promise.all([
      prisma.interviewRecord.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: interviewSelect,
      }),
      prisma.interviewRecord.count({ where }),
    ]);
  }

  const serialized = interviews.map((r) => {
    const { hasMissing, missingFields } = checkInputMissing({
      form: {
        interviewDate: r.interviewDate,
        startTime: r.startTime,
        endTime: r.endTime,
        interviewTool: r.interviewTool,
        resultFlag: r.resultFlag,
        interviewMemo: r.interviewMemo,
      },
      detail: r.detail as Record<string, unknown> | null,
      rating: r.rating as Record<string, unknown> | null,
      workHistoriesCount: r._count.workHistories,
    });
    return {
      ...r,
      interviewDate: r.interviewDate.toISOString(),
      candidateBirthday: r.candidate.birthday?.toISOString() ?? null,
      hasInputMissing: hasMissing,
      missingFields,
    };
  });

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

  // 前回面談メモ・結果取得
  const lastRecord = await prisma.interviewRecord.findFirst({
    where: { candidateId },
    orderBy: { interviewDate: "desc" },
    select: { interviewMemo: true, resultFlag: true },
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
      resultFlag: resultFlag || (lastRecord?.resultFlag && !TERMINATED_RESULTS.includes(lastRecord.resultFlag) ? lastRecord.resultFlag : null),
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
  } else {
    await copyFromPreviousInterview(candidateId, record.id);
  }

  // T-080: 最新面談の resultFlag に応じて Candidate.supportStatus を自動更新
  await applyLatestInterviewResultToSupportStatus(candidateId);

  const freshRecord = await prisma.interviewRecord.findUnique({
    where: { id: record.id },
    include: {
      detail: true,
      rating: true,
      memos: true,
      attachments: true,
      workHistories: true,
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
  });

  return NextResponse.json({ record: freshRecord ?? record });
}

const ATTACHMENT_BUCKET = "interview-attachments";

async function copyFromPreviousInterview(
  candidateId: string,
  newInterviewId: string,
): Promise<void> {
  try {
    const previous = await prisma.interviewRecord.findFirst({
      where: { candidateId, id: { not: newInterviewId } },
      orderBy: { interviewCount: "desc" },
      include: {
        detail: true,
        rating: true,
        memos: true,
        workHistories: true,
        attachments: true,
      },
    });

    if (!previous) {
      console.warn(`[copy-prev] No previous interview for candidate ${candidateId}`);
      return;
    }

    console.log(`[copy-prev] Copying from interview ${previous.id} to ${newInterviewId}`);

    if (previous.detail) {
      const { id: _id, interviewRecordId: _rid, createdAt: _ca, updatedAt: _ua, ...detailData } = previous.detail;
      const jsonFields = ["desiredJobTypes", "desiredIndustries", "desiredAreas"] as const;
      const sanitized: Record<string, unknown> = { ...detailData };
      for (const key of jsonFields) {
        if (sanitized[key] === null) sanitized[key] = Prisma.JsonNull;
      }
      await prisma.interviewDetail.create({
        data: { ...sanitized, interviewRecordId: newInterviewId } as Prisma.InterviewDetailUncheckedCreateInput,
      });
    }

    if (previous.rating) {
      const { id: _id, interviewRecordId: _rid, createdAt: _ca, updatedAt: _ua, ...ratingData } = previous.rating;
      await prisma.interviewRating.create({
        data: { ...ratingData, interviewRecordId: newInterviewId },
      });
    }

    if (previous.memos.length > 0) {
      await prisma.interviewMemo.createMany({
        data: previous.memos.map(({ id: _id, interviewRecordId: _rid, createdAt: _ca, updatedAt: _ua, ...rest }) => ({
          ...rest,
          interviewRecordId: newInterviewId,
        })),
      });
    }

    if (previous.workHistories.length > 0) {
      await prisma.workHistory.createMany({
        data: previous.workHistories.map(({ id: _id, interviewRecordId: _rid, createdAt: _ca, updatedAt: _ua, ...rest }) => ({
          ...rest,
          interviewRecordId: newInterviewId,
        })),
      });
    }

    for (const att of previous.attachments) {
      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .download(att.filePath);

        if (dlErr || !fileData) {
          console.warn(`[copy-prev] Download failed: ${att.filePath}`, dlErr);
          continue;
        }

        const ext = (att.fileName.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "");
        const newPath = `interviews/${newInterviewId}/${randomUUID()}.${ext}`;
        const buffer = Buffer.from(await fileData.arrayBuffer());

        const { error: upErr } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(newPath, buffer, {
            contentType: att.mimeType || "application/octet-stream",
            upsert: false,
          });

        if (upErr) {
          console.warn(`[copy-prev] Upload failed: ${newPath}`, upErr);
          continue;
        }

        await prisma.interviewAttachment.create({
          data: {
            interviewRecordId: newInterviewId,
            fileName: att.fileName,
            fileType: att.fileType,
            filePath: newPath,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            uploadedBy: "copy-prev",
          },
        });

        console.log(`[copy-prev] Copied attachment ${att.fileName} → ${newPath}`);
      } catch (e) {
        console.warn(`[copy-prev] Failed to copy attachment ${att.fileName}:`, e);
      }
    }

    console.log(`[copy-prev] Done copying from ${previous.id}`);
  } catch (e) {
    console.error(`[copy-prev] Failed:`, e);
  }
}

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
        if (!file.driveFileId) continue; // PDF実体が無い行はスキップ
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

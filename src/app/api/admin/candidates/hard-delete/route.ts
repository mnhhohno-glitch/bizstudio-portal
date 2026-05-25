import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { candidateIds?: unknown; confirmedHasData?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const candidateIds = Array.isArray(body.candidateIds)
    ? body.candidateIds.filter((x): x is string => typeof x === "string")
    : [];
  const confirmedHasData = body.confirmedHasData === true;

  if (candidateIds.length === 0) {
    return NextResponse.json(
      { error: "candidateIds is required" },
      { status: 400 }
    );
  }
  if (candidateIds.length > 50) {
    return NextResponse.json(
      { error: "一度に削除できるのは最大50件です" },
      { status: 400 }
    );
  }

  const candidates = await prisma.candidate.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, candidateNumber: true, name: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "対象求職者が見つかりません" },
      { status: 404 }
    );
  }

  const existingIds = candidates.map((c) => c.id);

  // 削除前に各候補の関連件数を集計
  const [
    interviewCounts,
    fileCounts,
    jobEntryCounts,
    jobResponseCounts,
    taskCounts,
    noteCounts,
    guideCounts,
    advisorSessionCounts,
    fileShareLinkCounts,
    jimuSessionCounts,
    memoCounts,
    hiddenIntroCounts,
    bsFolderCounts,
    settingsHistoryCounts,
  ] = await Promise.all([
    prisma.interviewRecord.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.candidateFile.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.jobEntry.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.candidateJobResponse.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.candidateNote.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.guideEntry.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.advisorChatSession.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.fileShareLink.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.jimuSession.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.candidateMemo.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.hiddenJobIntroduction.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.bSDocumentFolder.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
    prisma.candidateSettingsHistory.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: existingIds } },
      _count: { _all: true },
    }),
  ]);

  const toMap = (
    rows: { candidateId: string | null; _count: { _all: number } }[]
  ): Map<string, number> =>
    new Map(rows.map((r) => [r.candidateId ?? "", r._count._all]));

  const interviewMap = toMap(interviewCounts);
  const fileMap = toMap(fileCounts);
  const jobEntryMap = toMap(jobEntryCounts);
  const jobResponseMap = toMap(jobResponseCounts);
  const taskMap = toMap(taskCounts);
  const noteMap = toMap(noteCounts);
  const guideMap = toMap(guideCounts);
  const advisorMap = toMap(advisorSessionCounts);
  const shareLinkMap = toMap(fileShareLinkCounts);
  const jimuMap = toMap(jimuSessionCounts);
  const memoMap = toMap(memoCounts);
  const hiddenMap = toMap(hiddenIntroCounts);
  const bsFolderMap = toMap(bsFolderCounts);
  const settingsHistoryMap = toMap(settingsHistoryCounts);

  const hasDataIds = existingIds.filter(
    (id) =>
      (interviewMap.get(id) ?? 0) > 0 ||
      (fileMap.get(id) ?? 0) > 0 ||
      (jobEntryMap.get(id) ?? 0) > 0 ||
      (jobResponseMap.get(id) ?? 0) > 0 ||
      (taskMap.get(id) ?? 0) > 0
  );

  if (hasDataIds.length > 0 && !confirmedHasData) {
    return NextResponse.json(
      {
        error: "関連データを持つ求職者が含まれています。confirmedHasData=true を指定してください。",
        candidatesWithData: hasDataIds,
      },
      { status: 400 }
    );
  }

  // トランザクションで削除
  // - FileShareLink, CandidateNote, GuideEntry, JimuSession, Task, CandidateFile,
  //   AdvisorChatSession, InterviewRecord は onDelete: Cascade が無いため明示削除
  // - CandidateSettingsHistory, BSDocumentFolder, JobEntry, HiddenJobIntroduction,
  //   CandidateJobResponse, CandidateMemo は Cascade で自動削除
  // - MynaviRpaProcessingLog は SetNull
  await prisma.$transaction(async (tx) => {
    await tx.fileShareLink.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.candidateNote.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.guideEntry.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.jimuSession.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.task.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.candidateFile.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.advisorChatSession.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.interviewRecord.deleteMany({
      where: { candidateId: { in: existingIds } },
    });
    await tx.candidate.deleteMany({
      where: { id: { in: existingIds } },
    });

    for (const c of candidates) {
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "HARD_DELETE_CANDIDATE",
          targetType: "CANDIDATE",
          targetId: c.id,
          metadata: {
            candidateNumber: c.candidateNumber,
            fullName: c.name,
            deletedRelatedCounts: {
              interviews: interviewMap.get(c.id) ?? 0,
              files: fileMap.get(c.id) ?? 0,
              entries: jobEntryMap.get(c.id) ?? 0,
              jobResponses: jobResponseMap.get(c.id) ?? 0,
              tasks: taskMap.get(c.id) ?? 0,
              notes: noteMap.get(c.id) ?? 0,
              guideEntries: guideMap.get(c.id) ?? 0,
              advisorSessions: advisorMap.get(c.id) ?? 0,
              fileShareLinks: shareLinkMap.get(c.id) ?? 0,
              jimuSessions: jimuMap.get(c.id) ?? 0,
              candidateMemos: memoMap.get(c.id) ?? 0,
              hiddenJobIntroductions: hiddenMap.get(c.id) ?? 0,
              bsDocumentFolders: bsFolderMap.get(c.id) ?? 0,
              settingsHistories: settingsHistoryMap.get(c.id) ?? 0,
            },
          },
        },
      });
    }
  });

  return NextResponse.json({
    deletedCount: candidates.length,
    details: candidates.map((c) => ({
      candidateId: c.id,
      candidateNumber: c.candidateNumber,
      fullName: c.name,
      deletedRelatedCounts: {
        interviews: interviewMap.get(c.id) ?? 0,
        files: fileMap.get(c.id) ?? 0,
        entries: jobEntryMap.get(c.id) ?? 0,
        jobResponses: jobResponseMap.get(c.id) ?? 0,
        tasks: taskMap.get(c.id) ?? 0,
      },
    })),
  });
}

export const dynamic = "force-dynamic";

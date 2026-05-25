import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const FILE_CATEGORIES = [
  "ORIGINAL",
  "JOB_POSTING",
  "BS_DOCUMENT",
  "APPLICATION",
  "INTERVIEW_PREP",
  "MEETING",
  "BOOKMARK",
] as const;
type FileCategory = (typeof FILE_CATEGORIES)[number];

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { candidateIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const candidateIds = Array.isArray(body.candidateIds)
    ? body.candidateIds.filter((x): x is string => typeof x === "string")
    : [];

  if (candidateIds.length === 0) {
    return NextResponse.json(
      { error: "candidateIds is required" },
      { status: 400 }
    );
  }
  if (candidateIds.length > 100) {
    return NextResponse.json(
      { error: "一度にチェックできるのは最大100件です" },
      { status: 400 }
    );
  }

  const candidates = await prisma.candidate.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, candidateNumber: true, name: true },
  });

  const [
    interviewCounts,
    fileCountsByCategory,
    jobEntryCounts,
    jobResponseCounts,
    taskCounts,
  ] = await Promise.all([
    prisma.interviewRecord.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds } },
      _count: { _all: true },
    }),
    prisma.candidateFile.groupBy({
      by: ["candidateId", "category"],
      where: { candidateId: { in: candidateIds } },
      _count: { _all: true },
    }),
    prisma.jobEntry.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds } },
      _count: { _all: true },
    }),
    prisma.candidateJobResponse.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds } },
      _count: { _all: true },
    }),
  ]);

  const interviewMap = new Map<string, number>(
    interviewCounts.map((r) => [r.candidateId, r._count._all])
  );
  const jobEntryMap = new Map<string, number>(
    jobEntryCounts.map((r) => [r.candidateId, r._count._all])
  );
  const jobResponseMap = new Map<string, number>(
    jobResponseCounts.map((r) => [r.candidateId, r._count._all])
  );
  const taskMap = new Map<string, number>(
    taskCounts.map((r) => [r.candidateId ?? "", r._count._all])
  );

  const fileMap = new Map<string, { total: number; breakdown: Record<FileCategory, number> }>();
  for (const id of candidateIds) {
    fileMap.set(id, {
      total: 0,
      breakdown: FILE_CATEGORIES.reduce(
        (acc, c) => ({ ...acc, [c]: 0 }),
        {} as Record<FileCategory, number>
      ),
    });
  }
  for (const row of fileCountsByCategory) {
    const entry = fileMap.get(row.candidateId);
    if (!entry) continue;
    const count = row._count._all;
    entry.total += count;
    entry.breakdown[row.category as FileCategory] = count;
  }

  const items = candidateIds.map((id) => {
    const candidate = candidates.find((c) => c.id === id);
    const files = fileMap.get(id) ?? {
      total: 0,
      breakdown: FILE_CATEGORIES.reduce(
        (acc, c) => ({ ...acc, [c]: 0 }),
        {} as Record<FileCategory, number>
      ),
    };
    const counts = {
      interviews: interviewMap.get(id) ?? 0,
      files: files.total,
      fileBreakdown: files.breakdown,
      entries: jobEntryMap.get(id) ?? 0,
      jobResponses: jobResponseMap.get(id) ?? 0,
      tasks: taskMap.get(id) ?? 0,
    };
    const hasAnyData =
      counts.interviews > 0 ||
      counts.files > 0 ||
      counts.entries > 0 ||
      counts.jobResponses > 0 ||
      counts.tasks > 0;
    return {
      candidateId: id,
      candidateNumber: candidate?.candidateNumber ?? "",
      fullName: candidate?.name ?? "",
      counts,
      hasAnyData,
      exists: !!candidate,
    };
  });

  const summary = {
    total: items.length,
    withData: items.filter((i) => i.hasAnyData).length,
    clean: items.filter((i) => !i.hasAnyData).length,
  };

  return NextResponse.json({ items, summary });
}

export const dynamic = "force-dynamic";

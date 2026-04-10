import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import CandidateListClient from "./CandidateListClient";

export default async function CandidateMasterPage() {
  const actor = await getSessionUser();

  const [candidates, totalCount, employees] = await Promise.all([
    prisma.candidate.findMany({
      orderBy: { candidateNumber: "desc" },
      include: { employee: { select: { id: true, name: true } } },
    }),
    prisma.candidate.count(),
    prisma.employee.findMany({
      where: { status: "active" },
      orderBy: { employeeNumber: "asc" },
    }),
  ]);

  // Job status determination
  const candidateIds = candidates.map((c) => c.id);
  const [entryCounts, bookmarkCounts] = await Promise.all([
    prisma.jobEntry.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds } },
      _count: { id: true },
    }),
    prisma.candidateFile.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds }, category: "BOOKMARK" },
      _count: { id: true },
    }),
  ]);
  const entryCountMap = new Map(entryCounts.map((e) => [e.candidateId, e._count.id]));
  const bookmarkCountMap = new Map(bookmarkCounts.map((b) => [b.candidateId, b._count.id]));

  function determineJobStatus(candidateId: string): "entry" | "introduced" | "before" {
    if (entryCountMap.has(candidateId)) return "entry";
    if (bookmarkCountMap.has(candidateId)) return "introduced";
    return "before";
  }

  const serialized = candidates.map((c) => ({
    id: c.id,
    candidateNumber: c.candidateNumber,
    name: c.name,
    nameKana: c.nameKana,
    gender: c.gender,
    employee: c.employee,
    createdAt: c.createdAt.toISOString(),
    supportStatus: (c.supportStatus as string) || "BEFORE",
    supportEndReason: (c.supportEndReason as string) || null,
    jobStatus: determineJobStatus(c.id),
  }));

  // ログインユーザーに対応する社員IDを取得
  const currentEmployee = actor
    ? employees.find((e) => e.name === actor.name)
    : null;

  return (
    <div>
      <CandidateListClient
        initialCandidates={serialized}
        initialTotalCount={totalCount}
        employees={employees.map((e) => ({
          id: e.id,
          employeeNumber: e.employeeNumber,
          name: e.name,
        }))}
        currentEmployeeId={currentEmployee?.id ?? null}
      />
    </div>
  );
}

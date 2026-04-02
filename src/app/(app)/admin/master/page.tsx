import { prisma } from "@/lib/prisma";
import CandidateListClient from "./CandidateListClient";

export default async function CandidateMasterPage() {
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

  // Job status determination (entry only)
  const candidateIds = candidates.map((c) => c.id);
  const entryCounts = await prisma.jobEntry.groupBy({
    by: ["candidateId"],
    where: { candidateId: { in: candidateIds } },
    _count: { id: true },
  });
  const entryCountMap = new Map(
    entryCounts.map((e) => [e.candidateId, e._count.id])
  );

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
    jobStatus: entryCountMap.has(c.id) ? ("entry" as const) : null,
  }));

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
      />
    </div>
  );
}

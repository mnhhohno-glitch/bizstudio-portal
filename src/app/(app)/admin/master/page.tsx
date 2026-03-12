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

  const serialized = candidates.map((c) => ({
    id: c.id,
    candidateNumber: c.candidateNumber,
    name: c.name,
    nameKana: c.nameKana,
    gender: c.gender,
    employee: c.employee,
    createdAt: c.createdAt.toISOString(),
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

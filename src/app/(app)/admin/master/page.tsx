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

  // Job status determination
  const candidateIds = candidates.map((c) => c.id);
  const entryCounts = await prisma.jobEntry.groupBy({
    by: ["candidateId"],
    where: { candidateId: { in: candidateIds } },
    _count: { id: true },
  });
  const entryCountMap = new Map(
    entryCounts.map((e) => [e.candidateId, e._count.id])
  );

  const KYUUJIN_PDF_TOOL_URL = process.env.KYUUJIN_PDF_TOOL_URL;
  const candidatesWithoutEntry = candidates.filter(
    (c) => !entryCountMap.has(c.id) && c.candidateNumber
  );

  const jobCheckMap = new Map<string, boolean>();
  if (KYUUJIN_PDF_TOOL_URL && candidatesWithoutEntry.length > 0) {
    const results = await Promise.allSettled(
      candidatesWithoutEntry.map(async (c) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(
            `${KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/${c.candidateNumber}/jobs`,
            { signal: controller.signal }
          );
          if (!res.ok) return { candidateId: c.id, hasJobs: false };
          const data = await res.json();
          return { candidateId: c.id, hasJobs: data.total_jobs > 0 };
        } catch {
          return { candidateId: c.id, hasJobs: false };
        } finally {
          clearTimeout(timeout);
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        jobCheckMap.set(r.value.candidateId, r.value.hasJobs);
      }
    }
  }

  const serialized = candidates.map((c) => {
    let jobStatus: "entry" | "introduced" | "assigned";
    if (entryCountMap.has(c.id)) {
      jobStatus = "entry";
    } else if (jobCheckMap.get(c.id)) {
      jobStatus = "introduced";
    } else {
      jobStatus = "assigned";
    }
    return {
      id: c.id,
      candidateNumber: c.candidateNumber,
      name: c.name,
      nameKana: c.nameKana,
      gender: c.gender,
      employee: c.employee,
      createdAt: c.createdAt.toISOString(),
      jobStatus,
    };
  });

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

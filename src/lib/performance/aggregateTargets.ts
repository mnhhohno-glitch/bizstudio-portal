import { prisma } from "@/lib/prisma";

export type AggregatedTarget = {
  interviewCount: number;
  existingInterviewCount: number;
  introductionCount: number;
  entryCount: number;
  documentPassCount: number;
  offerCount: number;
  acceptanceCount: number;
  unitPrice: number;
};

export async function aggregateAllCaTargets(
  yearMonths: string[],
): Promise<Map<string, AggregatedTarget>> {
  if (yearMonths.length === 0) return new Map();

  const activeCas = await prisma.employee.findMany({
    where: { jobCategory: "CA", status: "active" },
    select: { id: true },
  });
  if (activeCas.length === 0) return new Map();

  const targets = await prisma.performanceTarget.findMany({
    where: {
      employeeId: { in: activeCas.map((e) => e.id) },
      yearMonth: { in: yearMonths },
    },
  });

  const revByMonth = new Map<string, number>();
  const aggByMonth = new Map<string, AggregatedTarget>();

  for (const t of targets) {
    let agg = aggByMonth.get(t.yearMonth);
    if (!agg) {
      agg = {
        interviewCount: 0, existingInterviewCount: 0, introductionCount: 0,
        entryCount: 0, documentPassCount: 0, offerCount: 0, acceptanceCount: 0,
        unitPrice: 0,
      };
      aggByMonth.set(t.yearMonth, agg);
      revByMonth.set(t.yearMonth, 0);
    }
    agg.interviewCount += t.interviewCount;
    agg.existingInterviewCount += t.existingInterviewCount ?? 0;
    agg.introductionCount += t.introductionCount;
    agg.entryCount += t.entryCount;
    agg.documentPassCount += t.documentPassCount;
    agg.offerCount += t.offerCount;
    agg.acceptanceCount += t.acceptanceCount;
    revByMonth.set(t.yearMonth, (revByMonth.get(t.yearMonth) ?? 0) + t.targetRevenue);
  }

  for (const [ym, agg] of aggByMonth) {
    const rev = revByMonth.get(ym) ?? 0;
    agg.unitPrice = agg.acceptanceCount > 0 ? rev / agg.acceptanceCount : 0;
  }

  return aggByMonth;
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";

function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function parseInt_(val: unknown): number | null {
  if (val === "" || val === null || val === undefined) return null;
  const n = parseInt(String(val));
  return isNaN(n) ? null : n;
}

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entries } = await request.json();
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "entries array is required" }, { status: 400 });
  }

  // Pre-fetch all employees for CA lookup
  const employees = await prisma.employee.findMany({
    select: { id: true, employeeNumber: true },
  });
  const employeeMap = new Map(employees.map((e) => [e.employeeNumber, e.id]));

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    try {
      // 1. candidateNumber → candidateId
      const candidate = await prisma.candidate.findFirst({
        where: { candidateNumber: String(entry.candidateNumber) },
        select: { id: true },
      });

      if (!candidate) {
        skipped++;
        errors.push(`${entry.fmEntryNo}: 求職者 ${entry.candidateNumber} が見つかりません`);
        continue;
      }

      // 2. Duplicate check: fmEntryNo
      if (entry.fmEntryNo) {
        const existingByFm = await prisma.jobEntry.findFirst({
          where: { fmEntryNo: entry.fmEntryNo },
          select: { id: true },
        });
        if (existingByFm) {
          skipped++;
          continue;
        }
      }

      // 2b. Duplicate check: candidateId + externalJobNo
      if (entry.externalJobNo) {
        const existingByJobNo = await prisma.jobEntry.findFirst({
          where: {
            candidateId: candidate.id,
            externalJobNo: entry.externalJobNo,
          },
          select: { id: true },
        });
        if (existingByJobNo) {
          skipped++;
          continue;
        }
      }

      // 2c. Duplicate check: candidateId + companyName + jobTitle
      if (entry.companyName) {
        const existingByCompany = await prisma.jobEntry.findFirst({
          where: {
            candidateId: candidate.id,
            companyName: entry.companyName,
            jobTitle: entry.jobTitle || "",
          },
          select: { id: true },
        });
        if (existingByCompany) {
          skipped++;
          continue;
        }
      }

      // 3. CA lookup
      const staffId = entry.careerAdvisorId
        ? employeeMap.get(entry.careerAdvisorId) || null
        : null;

      // 4. Determine isActive
      const detail = entry.entryFlagDetail || "";
      const isActive = entry.status !== "終了" && !SELECTION_ENDED_DETAILS.includes(detail);

      // 5. Create entry
      await prisma.jobEntry.create({
        data: {
          candidateId: candidate.id,
          externalJobId: 0,
          companyName: entry.companyName || "",
          jobTitle: entry.jobTitle || "",
          jobDb: entry.jobDb || null,
          prefecture: entry.prefecture || null,
          externalJobNo: entry.externalJobNo || null,
          status: entry.status || "有効",
          entryFlag: entry.entryFlag || "求人紹介",
          entryFlagDetail: entry.entryFlagDetail || "検討中",
          companyFlag: entry.companyFlag || null,
          personFlag: entry.personFlag || null,
          careerAdvisorId: staffId,
          entryDate: parseDate(entry.entryDate) || parseDate(entry.jobIntroDate) || new Date(),
          introducedAt: parseDate(entry.introducedAt) || parseDate(entry.jobIntroDate) || new Date(),
          jobIntroDate: parseDate(entry.jobIntroDate),
          documentSubmitDate: parseDate(entry.documentSubmitDate),
          documentPassDate: parseDate(entry.documentPassDate),
          interviewPrepDate: parseDate(entry.interviewPrepDate),
          interviewPrepTime: entry.interviewPrepTime || null,
          firstInterviewDate: parseDate(entry.firstInterviewDate),
          firstInterviewTime: entry.firstInterviewTime || null,
          secondInterviewDate: parseDate(entry.secondInterviewDate),
          secondInterviewTime: entry.secondInterviewTime || null,
          finalInterviewDate: parseDate(entry.finalInterviewDate),
          finalInterviewTime: entry.finalInterviewTime || null,
          offerDate: parseDate(entry.offerDate),
          offerDeadline: parseDate(entry.offerDeadline),
          offerMeetingDate: parseDate(entry.offerMeetingDate),
          offerMeetingTime: entry.offerMeetingTime || null,
          acceptanceDate: parseDate(entry.acceptanceDate),
          joinDate: parseDate(entry.joinDate),
          aptitudeTestExists: entry.aptitudeTestExists === "true" || entry.aptitudeTestExists === true,
          aptitudeTestDeadline: parseDate(entry.aptitudeTestDeadline),
          memo: entry.memo || null,
          theoreticalIncome: parseInt_(entry.theoreticalIncome),
          referralFee: parseInt_(entry.referralFee),
          revenue: parseInt_(entry.revenue),
          grossProfit: parseInt_(entry.grossProfit),
          route: entry.route || null,
          fmEntryNo: entry.fmEntryNo || null,
          isActive,
        },
      });

      created++;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${entry.fmEntryNo || "unknown"}: ${msg}`);
    }
  }

  return NextResponse.json({
    result: { created, skipped, failed, total: entries.length },
    errors: errors.slice(0, 50),
  });
}

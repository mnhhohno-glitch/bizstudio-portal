// T-071 明細一覧 API。マトリクスと同条件で対象候補者（明細行）を返す。
//   - 担当軸（candidate.employeeId、全員=all なら全CA）・到達ベース（段階日付が期間レンジ内）・無効含む・アーカイブ除く。
//   - 期間＝起算日と粒度から算出した全列カバー範囲（= マトリクスの TOTAL 範囲）。
//   - summary.persons（候補者ユニーク）= マトリクスの「人数」、summary.records = 明細行数。
// GET /api/performance/detail?employeeId=&anchorDate=&granularity=&tab=&stage=

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { buildColumns, type Granularity } from "@/lib/performance/columns";
import { Prisma } from "@prisma/client";
import { INTERVIEW_DECLINED_FLAGS } from "@/lib/dailyReport/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POST_APP = ["応募", "エントリー", "書類選考", "面接", "内定", "入社済"];
const ROW_LIMIT = 1000;

function ymd(d: Date | null): string | null {
  return d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null;
}
function ageOf(birthday: Date | null): number | null {
  if (!birthday) return null;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const [ty, tm, td] = today.split("-").map((s) => parseInt(s, 10));
  const b = birthday.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).split("-").map((s) => parseInt(s, 10));
  let age = ty - b[0];
  if (tm < b[1] || (tm === b[1] && td < b[2])) age--;
  return age >= 0 && age < 120 ? age : null;
}

const CANDIDATE_SELECT = {
  candidateNumber: true,
  name: true,
  gender: true,
  birthday: true,
  recruiterName: true,
  employee: { select: { name: true } },
} as const;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const anchorDate = searchParams.get("anchorDate");
  const gParam = searchParams.get("granularity");
  const granularity: Granularity = gParam === "day" || gParam === "month" ? gParam : "week";
  const tab = searchParams.get("tab") || "entry";
  const stage = searchParams.get("stage") || "documentPass"; // selection 用

  if (!employeeId || !anchorDate || !DATE_RE.test(anchorDate)) {
    return NextResponse.json({ error: "employeeId と anchorDate が必要です" }, { status: 400 });
  }

  const allCas = employeeId === "all";
  let userId = "__nonexistent__";
  if (!allCas) {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    if (!emp) return NextResponse.json({ error: "employee not found" }, { status: 404 });
    userId = emp.userId ?? "__nonexistent__";
  }

  // 全列カバー範囲（= TOTAL 範囲）
  const columns = buildColumns(granularity, anchorDate);
  const from = columns[0].from;
  const to = columns[columns.length - 1].to;
  const range = { gte: from, lte: to };

  // 候補者の担当フィルタ（全員はなし）
  const candFilter: Prisma.CandidateWhereInput = allCas ? {} : { employeeId };

  // === 面談 ===
  if (tab === "interview") {
    const where: Prisma.InterviewRecordWhereInput = {
      candidate: candFilter,
      interviewDate: range,
      OR: [{ resultFlag: null }, { resultFlag: { notIn: [...INTERVIEW_DECLINED_FLAGS] } }],
    };
    const [records, persons, rows] = await Promise.all([
      prisma.interviewRecord.count({ where }),
      prisma.interviewRecord.findMany({ where, select: { candidateId: true }, distinct: ["candidateId"] }).then((r) => r.length),
      prisma.interviewRecord.findMany({
        where,
        select: {
          id: true, interviewDate: true, interviewType: true, interviewCount: true, resultFlag: true,
          interviewer: { select: { name: true } },
          candidate: { select: CANDIDATE_SELECT },
        },
        orderBy: { interviewDate: "desc" },
        take: ROW_LIMIT,
      }),
    ]);
    return NextResponse.json({
      tab, summary: { persons, records },
      rows: rows.map((r) => ({
        id: r.id,
        interviewDate: ymd(r.interviewDate),
        interviewType: r.interviewType,
        interviewCount: r.interviewCount,
        resultFlag: r.resultFlag,
        caName: r.candidate.employee?.name ?? null,
        rcName: r.interviewer?.name ?? r.candidate.recruiterName ?? null,
        candidateNumber: r.candidate.candidateNumber,
        candidateName: r.candidate.name,
        gender: r.candidate.gender,
        age: ageOf(r.candidate.birthday),
      })),
    });
  }

  // === 求人紹介（CandidateFile BOOKMARK） ===
  if (tab === "proposal") {
    const where: Prisma.CandidateFileWhereInput = {
      category: "BOOKMARK",
      lastExportedAt: range,
      ...(allCas ? {} : { uploadedByUserId: userId }),
      candidate: candFilter,
    };
    const [records, persons, rows] = await Promise.all([
      prisma.candidateFile.count({ where }),
      prisma.candidateFile.findMany({ where, select: { candidateId: true }, distinct: ["candidateId"] }).then((r) => r.length),
      prisma.candidateFile.findMany({
        where,
        select: { id: true, fileName: true, lastExportedAt: true, candidate: { select: CANDIDATE_SELECT } },
        orderBy: { lastExportedAt: "desc" },
        take: ROW_LIMIT,
      }),
    ]);
    return NextResponse.json({
      tab, summary: { persons, records },
      rows: rows.map((r) => ({
        id: r.id,
        proposalDate: ymd(r.lastExportedAt),
        jobTitle: r.fileName,
        caName: r.candidate.employee?.name ?? null,
        rcName: r.candidate.recruiterName ?? null,
        candidateNumber: r.candidate.candidateNumber,
        candidateName: r.candidate.name,
        gender: r.candidate.gender,
        age: ageOf(r.candidate.birthday),
      })),
    });
  }

  // === エントリー / 選考状況（JobEntry） ===
  const jobWhere: Prisma.JobEntryWhereInput = { candidate: candFilter, archivedAt: null };
  if (tab === "selection") {
    if (stage === "offer") jobWhere.offerDate = range;
    else if (stage === "acceptance") jobWhere.acceptanceDate = range;
    else jobWhere.documentPassDate = range;
  } else {
    // entry
    jobWhere.entryFlag = { in: POST_APP };
    jobWhere.entryDate = range;
  }

  const [records, persons, rows] = await Promise.all([
    prisma.jobEntry.count({ where: jobWhere }),
    prisma.jobEntry.findMany({ where: jobWhere, select: { candidateId: true }, distinct: ["candidateId"] }).then((r) => r.length),
    prisma.jobEntry.findMany({
      where: jobWhere,
      select: {
        id: true, entryDate: true, documentPassDate: true, firstInterviewDate: true, finalInterviewDate: true,
        offerDate: true, acceptanceDate: true,
        prefecture: true, entryFlag: true, entryFlagDetail: true, companyName: true, jobTitle: true,
        candidate: { select: CANDIDATE_SELECT },
      },
      orderBy: { entryDate: "desc" },
      take: ROW_LIMIT,
    }),
  ]);

  return NextResponse.json({
    tab, stage: tab === "selection" ? stage : null,
    summary: { persons, records },
    rows: rows.map((r) => ({
      id: r.id,
      entryDate: ymd(r.entryDate),
      documentPassDate: ymd(r.documentPassDate),
      firstInterviewDate: ymd(r.firstInterviewDate),
      finalInterviewDate: ymd(r.finalInterviewDate),
      offerDate: ymd(r.offerDate),
      acceptanceDate: ymd(r.acceptanceDate),
      caName: r.candidate.employee?.name ?? null,
      rcName: r.candidate.recruiterName ?? null,
      candidateNumber: r.candidate.candidateNumber,
      candidateName: r.candidate.name,
      gender: r.candidate.gender,
      age: ageOf(r.candidate.birthday),
      prefecture: r.prefecture,
      entryFlag: r.entryFlag,
      entryFlagDetail: r.entryFlagDetail,
      companyName: r.companyName,
      jobTitle: r.jobTitle,
    })),
  });
}

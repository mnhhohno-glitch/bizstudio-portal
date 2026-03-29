import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const entryFlag = sp.get("entryFlag");
  const careerAdvisorId = sp.get("careerAdvisorId");
  const candidateName = sp.get("candidateName");
  const companyName = sp.get("companyName");
  const includeInactive = sp.get("includeInactive") === "true";
  const hasJoined = sp.get("hasJoined");

  const where: Prisma.JobEntryWhereInput = {};
  if (!includeInactive) where.isActive = true;
  if (entryFlag) where.entryFlag = entryFlag;
  if (careerAdvisorId) where.careerAdvisorId = careerAdvisorId;
  if (companyName) where.companyName = { contains: companyName, mode: "insensitive" };
  if (candidateName) where.candidate = { name: { contains: candidateName, mode: "insensitive" } };
  if (hasJoined === "true") where.hasJoined = true;

  const entries = await prisma.jobEntry.findMany({
    where,
    include: { candidate: { select: { name: true, candidateNumber: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const fmtDate = (d: Date | null) => d ? d.toISOString().slice(0, 10) : "";

  const headers = [
    "求職者名", "求職者番号", "紹介先企業", "求人タイトル", "外部求人NO", "求人DB",
    "都道府県", "求人種別", "状況", "エントリーフラグ", "フラグ詳細",
    "企業対応", "本人対応", "求人チェック", "有E", "入社",
    "エントリー日", "初回面談日", "求人紹介日", "書類提出日", "書類通過日",
    "適性検査", "適性検査期限", "面接対策日", "面接対策時間",
    "一次面接日", "一次面接時間", "最終面接日", "最終面接時間",
    "内定日", "承諾期限", "オファー面談日", "オファー面談時間",
    "承諾日", "入社日", "メモ", "有効",
  ];

  const rows = entries.map((e) => [
    e.candidate.name, e.candidate.candidateNumber, e.companyName, e.jobTitle,
    e.externalJobNo || "", e.jobDb || "", e.prefecture || "", e.jobCategory || "",
    e.status || "", e.entryFlag || "", e.entryFlagDetail || "",
    e.companyFlag || "", e.personFlag || "",
    e.hasJobPosting ? "○" : "", e.hasEntry ? "○" : "", e.hasJoined ? "○" : "",
    fmtDate(e.entryDate), fmtDate(e.firstMeetingDate), fmtDate(e.jobIntroDate),
    fmtDate(e.documentSubmitDate), fmtDate(e.documentPassDate),
    e.aptitudeTestExists ? "有" : "", fmtDate(e.aptitudeTestDeadline),
    fmtDate(e.interviewPrepDate), e.interviewPrepTime || "",
    fmtDate(e.firstInterviewDate), e.firstInterviewTime || "",
    fmtDate(e.finalInterviewDate), e.finalInterviewTime || "",
    fmtDate(e.offerDate), fmtDate(e.offerDeadline),
    fmtDate(e.offerMeetingDate), e.offerMeetingTime || "",
    fmtDate(e.acceptanceDate), fmtDate(e.joinDate),
    (e.memo || "").replace(/\n/g, " "), e.isActive ? "有効" : "無効",
  ]);

  const escapeCsv = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const bom = "\uFEFF";

  return new NextResponse(bom + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="entries_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

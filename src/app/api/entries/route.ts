import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { formatRecruiterName, normalizeRecruiterName } from "@/lib/recruiterDisplay";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1"));
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50")));
  const entryFlag = sp.get("entryFlag");
  const careerAdvisorId = sp.get("careerAdvisorId");
  const candidateName = sp.get("candidateName");
  const companyName = sp.get("companyName");
  const careerAdvisorName = sp.get("careerAdvisorName");
  const rcName = sp.get("rcName")?.trim() || "";          // 担当RC（formatRecruiterName 後にJS突合）
  const freeSearch = sp.get("freeSearch")?.trim() || "";  // 氏名/番号/企業名/求人名/担当CA の部分一致
  const includeInactive = sp.get("includeInactive") === "true";
  const includeArchived = sp.get("includeArchived") === "true";
  const urlMissingOnly = sp.get("urlMissingOnly") === "true";
  const hasJoined = sp.get("hasJoined");
  const sortBy = sp.get("sortBy") || "updatedAt";
  const sortOrder = sp.get("sortOrder") || "desc";

  // 罠#17: 日付範囲は JST 日境界（+09:00）で統一。toISOString().slice()/getDay() は使わない。
  const jstStart = (d: string) => new Date(`${d}T00:00:00+09:00`);
  const jstEnd = (d: string) => new Date(`${d}T23:59:59.999+09:00`);
  const dateRange = (from: string, to: string): Prisma.DateTimeFilter | null => {
    if (!from && !to) return null;
    const r: Prisma.DateTimeFilter = {};
    if (from) r.gte = jstStart(from);
    if (to) r.lte = jstEnd(to);
    return r;
  };
  // 項目別日付範囲。entryDate は旧 dateFrom/dateTo もJSTで受ける（後方互換・境界ずれ解消）。
  const DATE_PARAMS: [from: string, to: string, col: string][] = [
    ["entryFrom", "entryTo", "entryDate"],
    ["docSubmitFrom", "docSubmitTo", "documentSubmitDate"],
    ["docPassFrom", "docPassTo", "documentPassDate"],
    ["firstIntFrom", "firstIntTo", "firstInterviewDate"],
    ["secondIntFrom", "secondIntTo", "secondInterviewDate"],
    ["finalIntFrom", "finalIntTo", "finalInterviewDate"],
    ["offerFrom", "offerTo", "offerDate"],
    ["acceptFrom", "acceptTo", "acceptanceDate"],
    ["joinFrom", "joinTo", "joinDate"],
  ];

  // type(entryFlag)・rcName 以外の全条件＝andClauses + 単一フィールド。countBase にも流用。
  const andClauses: Prisma.JobEntryWhereInput[] = [];
  let hasDateFilter = false;
  for (const [fp, tp, col] of DATE_PARAMS) {
    let from = sp.get(fp) || "";
    let to = sp.get(tp) || "";
    if (col === "entryDate") { from = from || sp.get("dateFrom") || ""; to = to || sp.get("dateTo") || ""; }
    const r = dateRange(from, to);
    if (r) { andClauses.push({ [col]: r } as Prisma.JobEntryWhereInput); hasDateFilter = true; }
  }
  if (urlMissingOnly) andClauses.push({ OR: [{ jobDbUrl: null }, { jobDbUrl: "" }] });
  if (freeSearch) {
    andClauses.push({ OR: [
      { candidate: { name: { contains: freeSearch, mode: "insensitive" } } },
      { candidate: { candidateNumber: { contains: freeSearch, mode: "insensitive" } } },
      { companyName: { contains: freeSearch, mode: "insensitive" } },
      { jobTitle: { contains: freeSearch, mode: "insensitive" } },
      { candidate: { employee: { name: { contains: freeSearch, mode: "insensitive" } } } },
    ] });
  }

  const singleClauses: Prisma.JobEntryWhereInput = {};
  if (!includeArchived) singleClauses.archivedAt = null;
  // 日付検索作動時は「無効」を自動包含（既定の isActive=true 除外を外す）。includeInactive 明示は当然包含。
  if (!includeInactive && !hasDateFilter) singleClauses.isActive = true;
  if (careerAdvisorId) singleClauses.careerAdvisorId = careerAdvisorId;
  if (companyName) singleClauses.companyName = { contains: companyName, mode: "insensitive" };
  if (candidateName || careerAdvisorName) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidateWhere: any = {};
    if (candidateName) candidateWhere.name = { contains: candidateName, mode: "insensitive" };
    if (careerAdvisorName) candidateWhere.employee = { name: careerAdvisorName };
    singleClauses.candidate = candidateWhere;
  }
  if (hasJoined === "true") singleClauses.hasJoined = true;

  // countBase = entryFlag を除いた全条件（タブ別件数用）。where = countBase + entryFlag。
  const countBase: Prisma.JobEntryWhereInput = andClauses.length > 0 ? { ...singleClauses, AND: andClauses } : { ...singleClauses };
  const where: Prisma.JobEntryWhereInput = entryFlag ? { ...countBase, entryFlag } : countBase;

  const include = {
    candidate: { select: { id: true, name: true, candidateNumber: true, employeeId: true, recruiterName: true, employee: { select: { name: true } } } },
  } as const;
  const orderBy = { [sortBy]: sortOrder } as Prisma.JobEntryOrderByWithRelationInput;
  const flagValues = ["求人紹介", "応募", "エントリー", "書類選考", "面接", "内定", "入社済"];

  let entries: Prisma.JobEntryGetPayload<{ include: typeof include }>[];
  let total: number;
  const counts: Record<string, number> = {};
  // T-120: タブ別の人数（COUNT DISTINCT candidateId）。件数(counts)と同じ where 条件で集計する。
  // 「全件」は各タブ人数の合計ではなく、entryFlag 絞り込みなしの DISTINCT candidateId で別集計する
  // （同一求職者が複数ステータスにまたがるため単純合算は誤り）。
  const peopleCounts: Record<string, number> = {};

  const rcActive = rcName.length > 0;
  if (rcActive) {
    // 担当RC は formatRecruiterName（号機→実名）後にJS突合のため where に積めない。
    // countBase（entryFlag・rc 以外）で全件取得 → rc 絞り込み → 件数算出 → entryFlag 絞り → ページング。
    const q = normalizeRecruiterName(rcName);
    const all = await prisma.jobEntry.findMany({ where: countBase, include, orderBy });
    const rcAll = all.filter((e) =>
      normalizeRecruiterName(formatRecruiterName(e.candidate.recruiterName)).includes(q),
    );
    flagValues.forEach((f) => { counts[f] = rcAll.filter((e) => e.entryFlag === f).length; });
    counts["全件"] = rcAll.length;
    flagValues.forEach((f) => {
      peopleCounts[f] = new Set(rcAll.filter((e) => e.entryFlag === f).map((e) => e.candidateId)).size;
    });
    peopleCounts["全件"] = new Set(rcAll.map((e) => e.candidateId)).size;
    const filtered = entryFlag ? rcAll.filter((e) => e.entryFlag === entryFlag) : rcAll;
    total = filtered.length;
    entries = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);
  } else {
    const countResults = await Promise.all([
      prisma.jobEntry.findMany({ where, include, orderBy, skip: (page - 1) * limit, take: limit }),
      prisma.jobEntry.count({ where }),
      ...flagValues.map((f) => prisma.jobEntry.count({ where: { ...countBase, entryFlag: f } })),
      prisma.jobEntry.count({ where: countBase }),
      // T-120: 人数（DISTINCT candidateId）。groupBy は distinct count 非対応のため、
      // (entryFlag, candidateId) の一意ペアを取得し、JS でタブ別・全件を数える。
      prisma.jobEntry.groupBy({ by: ["entryFlag", "candidateId"], where: countBase }),
    ]);
    entries = countResults[0] as Prisma.JobEntryGetPayload<{ include: typeof include }>[];
    total = countResults[1] as number;
    flagValues.forEach((f, i) => { counts[f] = countResults[2 + i] as number; });
    counts["全件"] = countResults[2 + flagValues.length] as number;
    const peoplePairs = countResults[3 + flagValues.length] as { entryFlag: string | null; candidateId: string }[];
    flagValues.forEach((f) => { peopleCounts[f] = peoplePairs.filter((p) => p.entryFlag === f).length; });
    peopleCounts["全件"] = new Set(peoplePairs.map((p) => p.candidateId)).size;
  }

  return NextResponse.json({
    entries,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    counts,
    peopleCounts,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { candidateId, companyName, jobTitle, entryFlag, entryFlagDetail, externalJobNo, jobDb, jobType, prefecture, entryDate } = body;

  if (!candidateId || !companyName) {
    return NextResponse.json({ error: "candidateId and companyName are required" }, { status: 400 });
  }

  const entry = await prisma.jobEntry.create({
    data: {
      candidateId,
      companyName,
      jobTitle: jobTitle || "",
      externalJobId: 0,
      entryDate: entryDate ? new Date(entryDate) : new Date(),
      introducedAt: new Date(),
      entryFlag: entryFlag || "求人紹介",
      entryFlagDetail: entryFlagDetail || "検討中",
      externalJobNo: externalJobNo || null,
      jobDb: jobDb || null,
      jobType: jobType || null,
      prefecture: prefecture || null,
      careerAdvisorId: user.id,
      createdBy: user.id,
    },
    include: {
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}

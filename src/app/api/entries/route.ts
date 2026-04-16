import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

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
  const dateFrom = sp.get("dateFrom");
  const dateTo = sp.get("dateTo");
  const careerAdvisorName = sp.get("careerAdvisorName");
  const includeInactive = sp.get("includeInactive") === "true";
  const includeArchived = sp.get("includeArchived") === "true";
  const urlMissingOnly = sp.get("urlMissingOnly") === "true";
  const hasJoined = sp.get("hasJoined");
  const sortBy = sp.get("sortBy") || "updatedAt";
  const sortOrder = sp.get("sortOrder") || "desc";

  const where: Prisma.JobEntryWhereInput = {};

  if (!includeArchived) where.archivedAt = null;
  if (!includeInactive) where.isActive = true;
  if (entryFlag) where.entryFlag = entryFlag;
  if (careerAdvisorId) where.careerAdvisorId = careerAdvisorId;
  if (companyName) where.companyName = { contains: companyName, mode: "insensitive" };
  if (candidateName || careerAdvisorName) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidateWhere: any = {};
    if (candidateName) candidateWhere.name = { contains: candidateName, mode: "insensitive" };
    if (careerAdvisorName) candidateWhere.employee = { name: careerAdvisorName };
    where.candidate = candidateWhere;
  }
  if (dateFrom || dateTo) {
    where.entryDate = {};
    if (dateFrom) (where.entryDate as Prisma.DateTimeFilter).gte = new Date(dateFrom);
    if (dateTo) (where.entryDate as Prisma.DateTimeFilter).lte = new Date(dateTo + "T23:59:59Z");
  }
  if (hasJoined === "true") where.hasJoined = true;
  if (urlMissingOnly) {
    where.OR = [{ jobDbUrl: null }, { jobDbUrl: "" }];
  }

  const [entries, total] = await Promise.all([
    prisma.jobEntry.findMany({
      where,
      include: {
        candidate: { select: { id: true, name: true, candidateNumber: true, employeeId: true, employee: { select: { name: true } } } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.jobEntry.count({ where }),
  ]);

  // Counts for tabs — apply same filters as main query so tab counts reflect current filter state
  const countBase: Prisma.JobEntryWhereInput = {};
  if (!includeArchived) countBase.archivedAt = null;
  if (!includeInactive) countBase.isActive = true;
  if (careerAdvisorId) countBase.careerAdvisorId = careerAdvisorId;
  if (companyName) countBase.companyName = { contains: companyName, mode: "insensitive" };
  if (candidateName || careerAdvisorName) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidateWhere: any = {};
    if (candidateName) candidateWhere.name = { contains: candidateName, mode: "insensitive" };
    if (careerAdvisorName) candidateWhere.employee = { name: careerAdvisorName };
    countBase.candidate = candidateWhere;
  }
  if (dateFrom || dateTo) {
    countBase.entryDate = {};
    if (dateFrom) (countBase.entryDate as Prisma.DateTimeFilter).gte = new Date(dateFrom);
    if (dateTo) (countBase.entryDate as Prisma.DateTimeFilter).lte = new Date(dateTo + "T23:59:59Z");
  }

  if (urlMissingOnly) {
    countBase.OR = [{ jobDbUrl: null }, { jobDbUrl: "" }];
  }

  const flagValues = ["求人紹介", "応募", "エントリー", "書類選考", "面接", "内定", "入社済"];
  const countResults = await Promise.all([
    ...flagValues.map((f) => prisma.jobEntry.count({ where: { ...countBase, entryFlag: f } })),
    prisma.jobEntry.count({ where: countBase }),
  ]);

  const counts: Record<string, number> = {};
  flagValues.forEach((f, i) => { counts[f] = countResults[i]; });
  counts["全件"] = countResults[flagValues.length];

  return NextResponse.json({
    entries,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    counts,
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

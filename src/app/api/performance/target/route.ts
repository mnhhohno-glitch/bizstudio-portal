// T-073: 目標の取得・保存。employeeId + yearMonth で一意（upsert）。
// 保存は月目標のみ（週按分は表示時に businessDays.ts で計算）。数・率は Float（小数保持）。

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const yearMonth = searchParams.get("yearMonth");
  if (!employeeId || !yearMonth || !YYYY_MM.test(yearMonth)) {
    return NextResponse.json({ error: "employeeId と yearMonth(YYYY-MM) が必要です" }, { status: 400 });
  }

  const target = await prisma.performanceTarget.findUnique({
    where: { employeeId_yearMonth: { employeeId, yearMonth } },
  });
  return NextResponse.json({ target });
}

interface TargetBody {
  employeeId: string;
  yearMonth: string;
  targetRevenue: number;
  unitPrice: number;
  interviewCount: number;
  existingInterviewCount?: number | null;
  interviewPrepCount?: number | null;
  introductionCount: number;
  entryCount: number;
  documentPassCount: number;
  offerCount: number;
  acceptanceCount: number;
  introductionRate: number;
  entryRate: number;
  documentPassRate: number;
  offerRate: number;
  acceptanceRate: number;
  proposalPerPerson?: number | null; // 紹介の1人あたり件数（任意）
  firstInterviewRatio?: number | null; // 合計面談に占める初回面談の割合 0〜1（任意）
  weeklyOverrides?: { firstInterview: (number | null)[]; existingInterview: (number | null)[] } | null; // 週按分の手動調整（任意）
}

const NUM_FIELDS: (keyof TargetBody)[] = [
  "targetRevenue", "unitPrice",
  "interviewCount", "introductionCount", "entryCount", "documentPassCount", "offerCount", "acceptanceCount",
  "introductionRate", "entryRate", "documentPassRate", "offerRate", "acceptanceRate",
];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as TargetBody | null;
  if (!body || !body.employeeId || !body.yearMonth || !YYYY_MM.test(body.yearMonth)) {
    return NextResponse.json({ error: "employeeId と yearMonth(YYYY-MM) が必要です" }, { status: 400 });
  }
  for (const f of NUM_FIELDS) {
    const v = body[f];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return NextResponse.json({ error: `${f} は有限の数値で指定してください` }, { status: 400 });
    }
  }

  const optional = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const data = {
    targetRevenue: body.targetRevenue,
    unitPrice: body.unitPrice,
    interviewCount: body.interviewCount,
    existingInterviewCount: optional(body.existingInterviewCount),
    interviewPrepCount: optional(body.interviewPrepCount),
    introductionCount: body.introductionCount,
    entryCount: body.entryCount,
    documentPassCount: body.documentPassCount,
    offerCount: body.offerCount,
    acceptanceCount: body.acceptanceCount,
    introductionRate: body.introductionRate,
    entryRate: body.entryRate,
    documentPassRate: body.documentPassRate,
    offerRate: body.offerRate,
    acceptanceRate: body.acceptanceRate,
    proposalPerPerson: optional(body.proposalPerPerson),
    firstInterviewRatio: optional(body.firstInterviewRatio),
    // 週按分の手動調整（初回/既存面談）。未調整（null）なら自動配分（JSON null として保存）。
    weeklyOverrides: body.weeklyOverrides
      ? (body.weeklyOverrides as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
  };

  const target = await prisma.performanceTarget.upsert({
    where: { employeeId_yearMonth: { employeeId: body.employeeId, yearMonth: body.yearMonth } },
    create: { employeeId: body.employeeId, yearMonth: body.yearMonth, createdBy: user.id, ...data },
    update: { ...data },
  });

  return NextResponse.json({ target });
}

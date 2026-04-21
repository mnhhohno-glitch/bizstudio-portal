import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const histories = await prisma.workHistory.findMany({
    where: { interviewRecordId: id },
    orderBy: { order: "asc" },
  });
  return NextResponse.json({ workHistories: histories });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const items = body.workHistories as Array<{
    order: number;
    companyName?: string | null;
    businessContent?: string | null;
    tenureYear?: number | null;
    tenureMonth?: number | null;
    jobTypeFlag?: string | null;
    jobTypeMemo?: string | null;
    resignReasonLarge?: string | null;
    resignReasonMedium?: string | null;
    resignReasonSmall?: string | null;
    jobChangeReasonMemo?: string | null;
  }>;

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "workHistories must be an array" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.workHistory.deleteMany({ where: { interviewRecordId: id } }),
    ...items.map((item) =>
      prisma.workHistory.create({
        data: {
          interviewRecordId: id,
          order: item.order,
          companyName: item.companyName ?? null,
          businessContent: item.businessContent ?? null,
          tenureYear: item.tenureYear ?? null,
          tenureMonth: item.tenureMonth ?? null,
          jobTypeFlag: item.jobTypeFlag ?? null,
          jobTypeMemo: item.jobTypeMemo ?? null,
          resignReasonLarge: item.resignReasonLarge ?? null,
          resignReasonMedium: item.resignReasonMedium ?? null,
          resignReasonSmall: item.resignReasonSmall ?? null,
          jobChangeReasonMemo: item.jobChangeReasonMemo ?? null,
        },
      }),
    ),
  ]);

  const updated = await prisma.workHistory.findMany({
    where: { interviewRecordId: id },
    orderBy: { order: "asc" },
  });
  return NextResponse.json({ workHistories: updated });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const created = await prisma.workHistory.create({
    data: {
      interviewRecordId: id,
      order: body.order ?? 1,
      companyName: body.companyName ?? null,
      businessContent: body.businessContent ?? null,
      tenureYear: body.tenureYear ?? null,
      tenureMonth: body.tenureMonth ?? null,
      jobTypeFlag: body.jobTypeFlag ?? null,
      jobTypeMemo: body.jobTypeMemo ?? null,
      resignReasonLarge: body.resignReasonLarge ?? null,
      resignReasonMedium: body.resignReasonMedium ?? null,
      resignReasonSmall: body.resignReasonSmall ?? null,
      jobChangeReasonMemo: body.jobChangeReasonMemo ?? null,
    },
  });
  return NextResponse.json(created);
}

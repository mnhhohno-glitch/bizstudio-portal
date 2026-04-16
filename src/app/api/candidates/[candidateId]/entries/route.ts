import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

type RouteContext = { params: Promise<{ candidateId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const entries = await prisma.jobEntry.findMany({
    where: { candidateId },
    orderBy: { entryDate: "desc" },
  });

  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });
  if (!candidate) {
    return NextResponse.json(
      { error: "求職者が見つかりません" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const { entries, entryDate } = body;

  if (!entryDate || isNaN(new Date(entryDate).getTime())) {
    return NextResponse.json(
      { error: "有効なエントリー日を指定してください" },
      { status: 400 }
    );
  }

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json(
      { error: "エントリーデータが必要です" },
      { status: 400 }
    );
  }

  // Check for existing entries to skip duplicates
  const externalJobIds = entries.map(
    (e: { externalJobId: number }) => e.externalJobId
  );
  const existing = await prisma.jobEntry.findMany({
    where: {
      candidateId,
      externalJobId: { in: externalJobIds },
    },
    select: { externalJobId: true },
  });
  const existingIds = new Set(existing.map((e) => e.externalJobId));

  const newEntries = entries.filter(
    (e: { externalJobId: number }) => !existingIds.has(e.externalJobId)
  );

  if (newEntries.length > 0) {
    await prisma.jobEntry.createMany({
      data: newEntries.map(
        (e: {
          externalJobId: number;
          externalJobNo?: string | null;
          companyName: string;
          jobTitle: string;
          jobDb?: string;
          jobType?: string;
          jobCategory?: string;
          workLocation?: string;
          salary?: string;
          overtime?: string;
          areaMatch?: string;
          transfer?: string;
          originalUrl?: string;
          introducedAt: string;
        }) => ({
          candidateId,
          externalJobId: e.externalJobId,
          externalJobNo: e.externalJobNo ?? null,
          companyName: e.companyName,
          jobTitle: e.jobTitle,
          jobDb: e.jobDb ?? null,
          jobType: e.jobType ?? null,
          jobCategory: e.jobCategory ?? null,
          workLocation: e.workLocation ?? null,
          salary: e.salary ?? null,
          overtime: e.overtime ?? null,
          areaMatch: e.areaMatch ?? null,
          transfer: e.transfer ?? null,
          originalUrl: e.originalUrl ?? null,
          entryFlag: "エントリー",
          entryFlagDetail: "検討中",
          entryDate: new Date(entryDate),
          introducedAt: new Date(e.introducedAt),
          createdBy: user.id,
        })
      ),
    });
  }

  const skipped = entries.length - newEntries.length;

  if (newEntries.length > 0) {
    try {
      await recalculateSubStatusIfAuto(candidateId);
    } catch (e) {
      console.error("[entries.POST] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json(
    {
      created: newEntries.length,
      skipped,
      message: `${newEntries.length}件のエントリーを作成しました${skipped > 0 ? `（${skipped}件は既に登録済みのためスキップ）` : ""}`,
    },
    { status: 201 }
  );
}

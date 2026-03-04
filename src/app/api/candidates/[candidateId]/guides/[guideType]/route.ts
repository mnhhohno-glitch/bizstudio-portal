import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { GuideType } from "@prisma/client";

const VALID_GUIDE_TYPES: GuideType[] = ["INTERVIEW"];

type RouteContext = { params: Promise<{ candidateId: string; guideType: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId, guideType: rawType } = await context.params;
  const guideType = rawType.toUpperCase() as GuideType;

  if (!VALID_GUIDE_TYPES.includes(guideType)) {
    return NextResponse.json({ error: "無効なガイドタイプです" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  let guideEntry = await prisma.guideEntry.findUnique({
    where: { candidateId_guideType: { candidateId, guideType } },
  });

  if (!guideEntry) {
    guideEntry = await prisma.guideEntry.create({
      data: { candidateId, guideType, data: {} },
    });
  }

  return NextResponse.json({ guideEntry, candidate });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId, guideType: rawType } = await context.params;
  const guideType = rawType.toUpperCase() as GuideType;

  if (!VALID_GUIDE_TYPES.includes(guideType)) {
    return NextResponse.json({ error: "無効なガイドタイプです" }, { status: 400 });
  }

  const guideEntry = await prisma.guideEntry.findUnique({
    where: { candidateId_guideType: { candidateId, guideType } },
  });

  if (!guideEntry) {
    return NextResponse.json({ error: "ガイドエントリが見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { data } = body;

  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "dataフィールドが必要です" }, { status: 400 });
  }

  const updated = await prisma.guideEntry.update({
    where: { id: guideEntry.id },
    data: { data },
  });

  return NextResponse.json({ guideEntry: updated });
}

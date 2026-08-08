import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { generatePatternName } from "@/lib/rpa-scout/pattern-name";
import { pickConditionFields } from "@/lib/rpa-scout/pattern-fields";

export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const includeInactive = sp.get("all") === "1";

  const patterns = await prisma.rpaScoutPattern.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ targetMachineNo: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  return NextResponse.json({ patterns });
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const targetMachineNo =
    typeof body.targetMachineNo === "number" &&
    body.targetMachineNo >= 1 &&
    body.targetMachineNo <= 6
      ? body.targetMachineNo
      : null;

  const fields = pickConditionFields(body);
  if ((fields.jobCategories?.length ?? 0) > 3)
    return NextResponse.json({ error: "希望職種は最大3件までです" }, { status: 400 });

  // 保存時もプレビューと同一の生成関数を使う
  const name = generatePatternName(fields);
  if (!name)
    return NextResponse.json({ error: "条件が未選択のため名前を生成できません" }, { status: 400 });

  const duplicate = await prisma.rpaScoutPattern.findFirst({
    where: { name, isActive: true },
    select: { id: true },
  });

  const pattern = await prisma.rpaScoutPattern.create({
    data: {
      targetMachineNo,
      name,
      ...fields,
      prefectures: fields.prefectures ?? undefined,
      jobCategories: fields.jobCategories ?? undefined,
      workLocations: fields.workLocations ?? undefined,
      isMigrated: false,
      createdByUserId: actor.id,
    },
  });

  return NextResponse.json({ pattern, duplicateWarning: !!duplicate });
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { generatePatternName } from "@/lib/rpa-scout/pattern-name";
import { pickConditionFields } from "@/lib/rpa-scout/pattern-fields";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const existing = await prisma.rpaScoutPattern.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "パターンが見つかりません" }, { status: 404 });

  // isActive のみの更新（論理削除／復帰）は名前を再生成しない
  if (Object.keys(body).length === 1 && typeof body.isActive === "boolean") {
    const pattern = await prisma.rpaScoutPattern.update({
      where: { id },
      data: { isActive: body.isActive },
    });
    return NextResponse.json({ pattern });
  }

  const targetMachineNo =
    typeof body.targetMachineNo === "number" &&
    body.targetMachineNo >= 1 &&
    body.targetMachineNo <= 6
      ? body.targetMachineNo
      : null;

  const fields = pickConditionFields(body);
  if ((fields.jobCategories?.length ?? 0) > 3)
    return NextResponse.json({ error: "希望職種は最大3件までです" }, { status: 400 });

  // 条件編集の保存時は常に自動生成名で上書き。
  // 移行パターンを編集した場合は isMigrated=false に変更し rawConditions をクリアする
  const name = generatePatternName(fields);
  if (!name)
    return NextResponse.json({ error: "条件が未選択のため名前を生成できません" }, { status: 400 });

  const duplicate = await prisma.rpaScoutPattern.findFirst({
    where: { name, isActive: true, id: { not: id } },
    select: { id: true },
  });

  const pattern = await prisma.rpaScoutPattern.update({
    where: { id },
    data: {
      targetMachineNo,
      name,
      ...fields,
      prefectures: fields.prefectures ?? undefined,
      jobCategories: fields.jobCategories ?? undefined,
      workLocations: fields.workLocations ?? undefined,
      isMigrated: false,
      ...(existing.isMigrated ? { rawConditions: Prisma.DbNull } : {}),
    },
  });

  return NextResponse.json({ pattern, duplicateWarning: !!duplicate });
}

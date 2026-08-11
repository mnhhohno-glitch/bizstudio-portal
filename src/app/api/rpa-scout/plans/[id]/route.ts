import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { jstStringToDbDate, nowJstDateTimeLocal, ymdWeekday, dbDateToJstYmd } from "@/lib/rpa-scout/jst";
import { attachPlanNamesOne } from "@/lib/rpa-scout/plan-serialize";

// 編集（時間帯・パターン・件名・メモ）と「マイナビ反映済み」チェック（reflected: true/false）
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

  const existing = await prisma.rpaScoutPlan.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "計画が見つかりません" }, { status: 404 });

  // 反映チェックの切り替え
  if (typeof body.reflected === "boolean") {
    const wd = ymdWeekday(dbDateToJstYmd(existing.planDate));
    if (wd !== 0 && wd !== 6)
      return NextResponse.json({ error: "反映チェックは土日の計画のみ対象です" }, { status: 400 });
    const plan = await prisma.rpaScoutPlan.update({
      where: { id },
      data: body.reflected
        ? {
            // 反映日時もJST壁時計値で保持（罠#17）
            reflectedAt: jstStringToDbDate(nowJstDateTimeLocal()),
            reflectedByUserId: actor.id,
          }
        : { reflectedAt: null, reflectedByUserId: null },
    });
    return NextResponse.json({ plan: await attachPlanNamesOne(plan) });
  }

  // 内容編集
  const data: {
    timeSlot?: string;
    memo?: string | null;
    patternId?: string;
    patternName?: string;
    subjectTemplateId?: string;
    subjectName?: string;
  } = {};

  if (typeof body.timeSlot === "string") {
    if (!["AM", "PM", "EVENING"].includes(body.timeSlot))
      return NextResponse.json({ error: "時間帯が不正です" }, { status: 400 });
    data.timeSlot = body.timeSlot;
  }
  if ("memo" in body) {
    data.memo = typeof body.memo === "string" && body.memo !== "" ? body.memo : null;
  }
  if (typeof body.patternId === "string" && body.patternId) {
    const pattern = await prisma.rpaScoutPattern.findUnique({ where: { id: body.patternId } });
    if (!pattern)
      return NextResponse.json({ error: "パターンが見つかりません" }, { status: 404 });
    data.patternId = pattern.id;
    data.patternName = pattern.name; // スナップショット更新
  }
  if (typeof body.subjectTemplateId === "string" && body.subjectTemplateId) {
    const template = await prisma.rpaScoutSubjectTemplate.findUnique({
      where: { id: body.subjectTemplateId },
    });
    if (!template)
      return NextResponse.json({ error: "件名テンプレートが見つかりません" }, { status: 404 });
    data.subjectTemplateId = template.id;
    data.subjectName = template.name;
  }

  const plan = await prisma.rpaScoutPlan.update({ where: { id }, data });
  return NextResponse.json({ plan: await attachPlanNamesOne(plan) });
}

// 計画は実績ではないため物理削除でよい。
// 実績記録済みでも生成済みの RpaScoutLog は残す（実績は実際に配信した記録のため）
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.rpaScoutPlan.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "計画が見つかりません" }, { status: 404 });

  await prisma.rpaScoutPlan.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

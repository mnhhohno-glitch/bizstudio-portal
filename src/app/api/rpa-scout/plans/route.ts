import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { dbDateToJstYmd, jstStringToDbDate, ymdWeekday } from "@/lib/rpa-scout/jst";
import { attachPlanNames } from "@/lib/rpa-scout/plan-serialize";

// from/to（"YYYY-MM-DD" JST）で範囲取得。pendingWeekend=1 で「土日×未反映」のみに絞る
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const pendingWeekend = sp.get("pendingWeekend") === "1";

  const where: Prisma.RpaScoutPlanWhereInput = {};
  if (from || to) {
    where.planDate = {};
    if (from) where.planDate.gte = jstStringToDbDate(from);
    if (to) where.planDate.lt = jstStringToDbDate(to + "T23:59:59");
  }
  if (pendingWeekend) where.reflectedAt = null;

  let plans = await prisma.rpaScoutPlan.findMany({
    where,
    orderBy: [{ planDate: "asc" }, { machineNo: "asc" }],
  });

  if (pendingWeekend) {
    // 土日判定はJST壁時計値で行う（planDateはJST値をそのまま保持）
    plans = plans.filter((p) => {
      const wd = ymdWeekday(dbDateToJstYmd(p.planDate));
      return wd === 0 || wd === 6;
    });
  }

  return NextResponse.json({ plans: await attachPlanNames(plans) });
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const machineNo = typeof body.machineNo === "number" ? body.machineNo : null;
  if (machineNo == null || machineNo < 1 || machineNo > 6)
    return NextResponse.json({ error: "号機が不正です" }, { status: 400 });
  if (!["AM", "PM", "EVENING"].includes(body.timeSlot))
    return NextResponse.json({ error: "時間帯を選択してください" }, { status: 400 });
  if (typeof body.planDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.planDate))
    return NextResponse.json({ error: "計画日が不正です" }, { status: 400 });
  if (typeof body.patternId !== "string" || !body.patternId)
    return NextResponse.json({ error: "パターンを選択してください" }, { status: 400 });
  if (typeof body.subjectTemplateId !== "string" || !body.subjectTemplateId)
    return NextResponse.json({ error: "件名テンプレートを選択してください" }, { status: 400 });

  const [pattern, template] = await Promise.all([
    prisma.rpaScoutPattern.findUnique({ where: { id: body.patternId } }),
    prisma.rpaScoutSubjectTemplate.findUnique({ where: { id: body.subjectTemplateId } }),
  ]);
  if (!pattern)
    return NextResponse.json({ error: "パターンが見つかりません" }, { status: 404 });
  if (!template)
    return NextResponse.json({ error: "件名テンプレートが見つかりません" }, { status: 404 });

  const plan = await prisma.rpaScoutPlan.create({
    data: {
      // 日付のみ意味を持つ。JST壁時計値のまま保存（罠#17）
      planDate: jstStringToDbDate(body.planDate),
      timeSlot: body.timeSlot,
      machineNo,
      patternId: pattern.id,
      patternName: pattern.name, // スナップショット
      subjectTemplateId: template.id,
      subjectName: template.name, // スナップショット
      memo: typeof body.memo === "string" && body.memo !== "" ? body.memo : null,
      createdByUserId: actor.id,
    },
  });

  const [withNames] = await attachPlanNames([plan]);
  return NextResponse.json({ plan: withNames });
}

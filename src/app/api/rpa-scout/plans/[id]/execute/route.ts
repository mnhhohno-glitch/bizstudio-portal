import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { jstStringToDbDate } from "@/lib/rpa-scout/jst";
import { attachPlanNamesOne } from "@/lib/rpa-scout/plan-serialize";

// 配信計画をそのまま実績化する。計画の号機・パターン・件名を使って RpaScoutLog を1件作成し、
// 計画側に executedAt / executedLogId / executedByUserId を記録する（計画自体は削除しない）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  if (typeof body.recordedAt !== "string" || !body.recordedAt)
    return NextResponse.json({ error: "記録日時を入力してください" }, { status: 400 });

  let recordedAt: Date;
  try {
    // "YYYY-MM-DDTHH:mm"（JST壁時計）をそのままDBへ（罠#17: UTC変換しない）
    recordedAt = jstStringToDbDate(body.recordedAt);
  } catch {
    return NextResponse.json({ error: "記録日時の形式が不正です" }, { status: 400 });
  }

  const searchCount =
    typeof body.searchCount === "number" && Number.isFinite(body.searchCount)
      ? Math.trunc(body.searchCount)
      : null; // 空欄=停止記録

  const existing = await prisma.rpaScoutPlan.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "計画が見つかりません" }, { status: 404 });
  if (existing.executedAt)
    return NextResponse.json({ error: "この計画は既に実績として記録済みです" }, { status: 409 });

  const plan = await prisma.$transaction(async (tx) => {
    const log = await tx.rpaScoutLog.create({
      data: {
        machineNo: existing.machineNo,
        patternId: existing.patternId,
        patternName: existing.patternName, // 計画のスナップショットをそのまま引き継ぐ
        subjectTemplateId: existing.subjectTemplateId,
        subjectName: existing.subjectName,
        searchCount,
        recordedAt,
        recordedByUserId: actor.id,
      },
    });
    // 二重記録の防止（executedAt が既にある行は更新しない＝並行実行時は片方が0件更新で失敗する）
    const updated = await tx.rpaScoutPlan.updateMany({
      where: { id, executedAt: null },
      data: { executedAt: recordedAt, executedLogId: log.id, executedByUserId: actor.id },
    });
    if (updated.count === 0) throw new Error("ALREADY_EXECUTED");
    return tx.rpaScoutPlan.findUniqueOrThrow({ where: { id } });
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "ALREADY_EXECUTED") return null;
    throw e;
  });

  if (!plan)
    return NextResponse.json({ error: "この計画は既に実績として記録済みです" }, { status: 409 });

  return NextResponse.json({ plan: await attachPlanNamesOne(plan) });
}

// 実績記録の取り消し。生成した RpaScoutLog を削除し、計画側の3列をnullに戻す
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
  if (!existing.executedAt)
    return NextResponse.json({ error: "この計画は実績として記録されていません" }, { status: 400 });

  const logId = existing.executedLogId;
  const plan = await prisma.$transaction(async (tx) => {
    // 手動で消された後の取り消しでも計画側は必ず未実施に戻す
    if (logId) await tx.rpaScoutLog.deleteMany({ where: { id: logId } });
    return tx.rpaScoutPlan.update({
      where: { id },
      data: { executedAt: null, executedLogId: null, executedByUserId: null },
    });
  });

  return NextResponse.json({ plan: await attachPlanNamesOne(plan) });
}

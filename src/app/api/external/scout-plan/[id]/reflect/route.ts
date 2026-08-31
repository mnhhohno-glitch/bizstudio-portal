// T-178: PATCH /api/external/scout-plan/[id]/reflect
// RPA がマイナビ上で検索条件を上書き保存し終えた後の書き戻し口。
// 反映日時（reflectedAt）と、実ヒット件数を載せた実績（RpaScoutLog + 計画の executedAt/executedLogId）を作る。
// 画面の「実績として記録」と同じログ形式にするため、ログ生成は plan-log の共通関数を使う。
// 反映者・記録者は null で保存し、画面側は「RPA自動」と表示する。
// 曜日制限は設けない（毎日呼ばれる前提。画面の reflected チェックの土日制限とは無関係）。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedExternal } from "@/lib/schedule-tasks";
import { dbDateToJstOffsetIso, nowJstDbDate } from "@/lib/rpa-scout/jst";
import { createLogFromPlan } from "@/lib/rpa-scout/plan-log";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  }

  const hitCount = (body as { hitCount?: unknown }).hitCount;
  if (typeof hitCount !== "number" || !Number.isInteger(hitCount) || hitCount < 0) {
    return NextResponse.json(
      { error: "hitCount は0以上の整数で指定してください" },
      { status: 400 },
    );
  }

  const exists = await prisma.rpaScoutPlan.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "計画が見つかりません" }, { status: 404 });
  }

  // 反映日時・記録日時は JST壁時計値のまま保持する列（罠#17）
  const now = nowJstDbDate();

  const result = await prisma.$transaction(async (tx) => {
    // 同一計画への同時呼び出しでログが二重に増えないよう直列化する
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rpa-scout-plan-reflect:${id}`})::bigint)`;

    const plan = await tx.rpaScoutPlan.findUnique({ where: { id } });
    if (!plan) return null;

    if (plan.executedLogId) {
      // 2回目以降（RPAの再実行 or 人が先に記録済み）。新しいログは作らず件数を上書きする＝冪等
      const updated = await tx.rpaScoutLog.updateMany({
        where: { id: plan.executedLogId },
        data: { searchCount: hitCount },
      });
      let logId = plan.executedLogId;
      if (updated.count === 0) {
        // 参照先のログが手動削除されていた場合は作り直して繋ぎ直す
        const log = await createLogFromPlan(tx, plan, {
          searchCount: hitCount,
          recordedAt: plan.executedAt ?? now,
          recordedByUserId: null,
        });
        logId = log.id;
      }
      const after = await tx.rpaScoutPlan.update({
        where: { id },
        data: { reflectedAt: now, executedLogId: logId },
      });
      return { plan: after, logId };
    }

    // 初回。実績ログを1件作り、反映済み＋実施済みにする（担当者はいずれも null＝RPA自動）
    const log = await createLogFromPlan(tx, plan, {
      searchCount: hitCount,
      recordedAt: now,
      recordedByUserId: null,
    });
    const after = await tx.rpaScoutPlan.update({
      where: { id },
      data: {
        reflectedAt: now,
        reflectedByUserId: null,
        executedAt: now,
        executedLogId: log.id,
        executedByUserId: null,
      },
    });
    return { plan: after, logId: log.id };
  });

  if (!result) {
    return NextResponse.json({ error: "計画が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({
    id: result.plan.id,
    reflectedAt: result.plan.reflectedAt ? dbDateToJstOffsetIso(result.plan.reflectedAt) : null,
    executedAt: result.plan.executedAt ? dbDateToJstOffsetIso(result.plan.executedAt) : null,
    logId: result.logId,
    searchCount: hitCount,
  });
}

// 配信計画（RpaScoutPlan）のAPIレスポンス整形。plans / plans/[id] / plans/[id]/execute で共用する
import { prisma } from "@/lib/prisma";

// 想定件数の正規化。空欄・0以下は「想定なし」として null に寄せる（達成率の分母にしないため）
export function parseExpectedCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

type PlanLike = {
  reflectedByUserId: string | null;
  createdByUserId: string | null;
  executedByUserId: string | null;
  executedLogId: string | null;
};

export async function attachPlanNames<T extends PlanLike>(plans: T[]) {
  const userIds = Array.from(
    new Set(
      plans
        .flatMap((p) => [p.reflectedByUserId, p.createdByUserId, p.executedByUserId])
        .filter((v): v is string => !!v)
    )
  );
  // 実績記録済みの計画は、モーダル表示用に記録した検索件数も返す（ログ本体は別テーブル）
  const logIds = Array.from(
    new Set(plans.map((p) => p.executedLogId).filter((v): v is string => !!v))
  );
  const [users, logs] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [],
    logIds.length
      ? prisma.rpaScoutLog.findMany({
          where: { id: { in: logIds } },
          select: { id: true, searchCount: true },
        })
      : [],
  ]);
  const nameMap = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));
  const countMap = new Map(logs.map((l) => [l.id, l.searchCount]));
  return plans.map((p) => ({
    ...p,
    reflectedByName: p.reflectedByUserId ? (nameMap[p.reflectedByUserId] ?? null) : null,
    createdByName: p.createdByUserId ? (nameMap[p.createdByUserId] ?? null) : null,
    executedByName: p.executedByUserId ? (nameMap[p.executedByUserId] ?? null) : null,
    executedSearchCount: p.executedLogId ? (countMap.get(p.executedLogId) ?? null) : null,
  }));
}

export async function attachPlanNamesOne<T extends PlanLike>(plan: T) {
  const [withNames] = await attachPlanNames([plan]);
  return withNames;
}

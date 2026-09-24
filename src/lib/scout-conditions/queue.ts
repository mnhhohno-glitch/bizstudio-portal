// T-195: 予約（QUEUED）の並べ替え。同じ号機の中でだけ queue_order を入れ替える（別号機へは動かせない）。
import { prisma } from "@/lib/prisma";
import { conditionInclude, toConditionDto } from "./server";
import type { ConditionDto } from "./types";

export type MoveDirection = "up" | "down";

export async function moveQueuedCondition(
  id: string,
  direction: MoveDirection,
): Promise<{ ok: true; conditions: ConditionDto[]; moved: boolean } | { ok: false; error: string; status: number }> {
  const target = await prisma.scoutCondition.findUnique({ where: { id }, select: { id: true, machineId: true, status: true } });
  if (!target) return { ok: false, error: "条件が見つかりません", status: 404 };
  if (target.status !== "QUEUED") return { ok: false, error: "並べ替えできるのは「予約」の条件だけです", status: 400 };

  const queue = await prisma.scoutCondition.findMany({
    where: { machineId: target.machineId, status: "QUEUED" },
    orderBy: [{ queueOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const idx = queue.findIndex((q) => q.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  const moved = swapWith >= 0 && swapWith < queue.length;
  const ordered = queue.map((q) => q.id);
  if (moved) [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];

  // 同じ号機の予約を 1..n で振り直す（欠番・同値を解消しつつ入れ替える）
  await prisma.$transaction(
    ordered.map((cid, i) => prisma.scoutCondition.update({ where: { id: cid }, data: { queueOrder: i + 1 } })),
  );
  const rows = await prisma.scoutCondition.findMany({ where: { id: { in: ordered } }, include: conditionInclude });
  return { ok: true, conditions: rows.map(toConditionDto), moved };
}

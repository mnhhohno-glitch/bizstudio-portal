// T-209 / T-210: 日付が変わったときの配信条件の切替。
//
// T-209 では「その号機に有効（RUNNING）が無いとき、配信日が当日以前の予約を1件上げる」だけだった。
// これだと前日の有効が残っていると翌日の予約が永久に始まらない（2026-09-18 朝に1〜4号機すべてで発生し、
// 人が手で完了→有効にした）。T-210 で「前日の有効を自動で完了にする」を足し、号機ロックの中で
//   1. 前日の有効を完了（DONE）にする
//   2. 有効が無くなったら、予約の先頭を有効にする
// の順に実行する。判定そのものは rollover.ts（純関数）に置き、一覧の「翌朝有効」バッジと同じ規則を使う。
//
// 完了（1）は枯渇ではないので is_dry は立てない。枯渇の判定・通知・予約消化の順序（runs.ts）は触らない。
// 予約に上げられる行が無ければ、その号機は有効なしのまま（「予約が空」の通知・タスク起票は既存の枯渇経路のまま）。
//
// 呼び出し口は2か所: RPA の GET /api/external/scout-conditions/current（external.ts）と、
// 配信条件一覧の GET /api/scout/conditions（人が画面を開いたとき）。どちらも判定はここ1か所を通る。
//
// 排他: create.ts / runs.ts と同じ号機ロック（pg_advisory_xact_lock）。RPA の結果送信による枯渇切替と
// 同時に走っても直列化され、実行中が2件になることはない。
import { prisma } from "@/lib/prisma";
import { demoteOtherRunning, lockMachine } from "./create";
import { dbDateToYmd, instantToJstYmd, jstTodayYmd, ymdToDbDate } from "./dates";
import { conditionLabel } from "./label";
import { sendScoutLine } from "./queue-empty";
import { pickQueuedToActivate, shouldCompleteRunning, type RolloverRow } from "./rollover";

/** 1号機ぶんの結果。何も起きなければ completedIds=[] / activatedId=null */
export type RolloverOutcome = {
  machineId: string;
  /** 日付が変わったため完了（DONE）にした条件の id */
  completedIds: string[];
  /** 新しく有効（RUNNING）にした条件の id */
  activatedId: string | null;
};

const rolloverInclude = {
  template: { select: { name: true } },
  runs: { orderBy: { executedAt: "desc" as const }, take: 1, select: { executedAt: true } },
};

type RolloverRowSource = {
  id: string;
  deliveryDate: Date | null;
  queueOrder: number;
  createdAt: Date;
  runs: { executedAt: Date }[];
};

function toRolloverRow(c: RolloverRowSource): RolloverRow {
  return {
    id: c.id,
    deliveryYmd: dbDateToYmd(c.deliveryDate),
    queueOrder: c.queueOrder,
    createdAtIso: c.createdAt.toISOString(),
    lastRunYmd: c.runs[0] ? instantToJstYmd(c.runs[0].executedAt) : null,
  };
}

/**
 * 1号機ぶんの日付切替。判定はロックの中でやり直すので、呼ぶ前の下読み（有効が無さそう等）が古くなっていても安全。
 * LINE WORKS 通知はトランザクションの外で送る（通知の失敗で DB をロールバックしないため）。
 */
export async function runDateRollover(machineId: string): Promise<RolloverOutcome> {
  const todayYmd = jstTodayYmd();
  const today = ymdToDbDate(todayYmd);

  const tx = await prisma.$transaction(
    async (t) => {
      await lockMachine(t, machineId);

      // 1. 前日の有効を完了にする（有効は号機に1件のはずだが、念のため全件を見る）
      const runnings = await t.scoutCondition.findMany({
        where: { machineId, status: "RUNNING" },
        include: rolloverInclude,
        orderBy: [{ queueOrder: "asc" }, { updatedAt: "desc" }],
      });
      const stale = runnings.filter((c) => shouldCompleteRunning(toRolloverRow(c), todayYmd));
      if (stale.length > 0) {
        await t.scoutCondition.updateMany({
          where: { id: { in: stale.map((c) => c.id) } },
          data: { status: "DONE" }, // 枯渇ではないので is_dry は触らない
        });
      }

      // 有効が残っているなら（今日の配信日のもの）そのまま。予約は上げない
      if (runnings.length > stale.length) {
        return { completedIds: stale.map((c) => c.id), activated: null, prevLabel: null };
      }

      // 2. 予約の先頭を有効にする（配信日が空、または当日以前が対象）
      const queued = await t.scoutCondition.findMany({
        where: { machineId, status: "QUEUED" },
        include: rolloverInclude,
      });
      const next = pickQueuedToActivate(
        queued.map((c) => ({ ...toRolloverRow(c), row: c })),
        todayYmd,
      );
      if (!next) return { completedIds: stale.map((c) => c.id), activated: null, prevLabel: null };

      await t.scoutCondition.update({
        where: { id: next.id },
        // 配信日が空のまま有効にすると翌日の判定材料が無くなるので当日を入れる（create.ts / runs.ts と同じ扱い）
        data: { status: "RUNNING", deliveryDate: next.row.deliveryDate ?? today },
      });
      // T-198: 実行中は号機ごとに1件。上で0件になっているはずだが、念のため畳んでおく
      await demoteOtherRunning(t, machineId, next.id);

      return {
        completedIds: stale.map((c) => c.id),
        activated: { id: next.id, label: conditionLabel(next.row) },
        prevLabel: stale.length > 0 ? conditionLabel(stale[0]) : null,
      };
    },
    { timeout: 20000 },
  );

  // 有効が入れ替わったときだけ1行通知する（枯渇時の通知とは別。文面に「日付切替」を入れて見分けられるようにする）
  if (tx.activated && tx.completedIds.length > 0 && tx.prevLabel) {
    const machine = await prisma.rpaScoutMachine.findUnique({ where: { id: machineId }, select: { machineNo: true } });
    await sendScoutLine(
      `【スカウト】${machine?.machineNo ?? "?"}号機：日付切替により条件「${tx.prevLabel}」を完了 → 条件「${tx.activated.label}」に切替`,
    );
  }

  return { machineId, completedIds: tx.completedIds, activatedId: tx.activated?.id ?? null };
}

/**
 * 稼働中の号機をまとめて判定する（一覧を開いたとき用）。
 * 「有効の配信日が今日以降」の号機は何も起きないので、先に読みで落としてからロックを取る
 * （毎回全号機ぶんのロックを取らないため）。実際の判定は runDateRollover がロックの中でやり直す。
 */
export async function runDateRolloverForActiveMachines(): Promise<RolloverOutcome[]> {
  const todayYmd = jstTodayYmd();
  const machines = await prisma.rpaScoutMachine.findMany({ where: { isActive: true }, select: { id: true } });
  if (machines.length === 0) return [];

  const machineIds = machines.map((m) => m.id);
  const runnings = await prisma.scoutCondition.findMany({
    where: { machineId: { in: machineIds }, status: "RUNNING" },
    select: { machineId: true, deliveryDate: true },
  });
  // 配信日が今日以降の有効を持つ号機は対象外（完了にもならず、予約も上がらない）。
  // 配信日が空の有効は最新実行を見ないと判断できないので、ロックを取って runDateRollover に判定させる。
  const settled = new Set(
    runnings.filter((r) => r.deliveryDate !== null && dbDateToYmd(r.deliveryDate)! >= todayYmd).map((r) => r.machineId),
  );

  const out: RolloverOutcome[] = [];
  for (const machineId of machineIds) {
    if (settled.has(machineId)) continue;
    const r = await runDateRollover(machineId);
    if (r.completedIds.length > 0 || r.activatedId) out.push(r);
  }
  return out;
}

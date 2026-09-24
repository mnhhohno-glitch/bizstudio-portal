// T-209 / T-210 / T-211: 日付が変わったときの配信条件の切替。
//
// 運用ルール（T-211 で確定）: **有効になるのは「配信日が今日」の条件だけ**。前日のうちに翌日分を予約しておけば
// 翌朝に自動で有効になる。配信日が過ぎたものは自動で完了。号機ロックの中で次の順に実行する。
//   2-1. 前日以前の有効を完了（DONE）にする
//   2-2. 配信日が過ぎた予約を完了（DONE）にする（通知なし）
//   2-3. 有効が無ければ「配信日が今日」の予約のうち ▲▼ 順で一番上を有効にする
// T-212: この切替そのものの LINE WORKS 通知（「条件Aを完了 → 条件Bに切替」「本日の配信条件がありません」）は廃止した。
//   通知は朝の「本日の配信条件」まとめ1通（daily-summary.ts）に一本化し、ここは DB の状態を直すだけにする。
// 判定そのものは rollover.ts（純関数）に置き、一覧の「翌朝有効」バッジ・枯渇時の予約消化（runs.ts）と同じ規則を使う。
//
// T-210 は「配信日が今日以前の予約」を対象にしていたため、配信日が過去の予約（9/13）が9/18 に走り出し、
// さらに過去日付の有効が一覧を開くたびに 完了→切替→通知 を繰り返した。T-211 で「今日ちょうど」に限定した。
//
// 完了（2-1 / 2-2）は枯渇ではないので is_dry は立てない。枯渇の判定・通知・タスク起票（runs.ts / queue-empty.ts）は触らない。
//
// 呼び出し口は2か所: RPA の GET /api/external/scout-conditions/current（external.ts）と、
// 配信条件一覧の GET /api/scout/conditions（人が画面を開いたとき）。どちらも判定はここ1か所を通る。
//
// 排他: create.ts / runs.ts と同じ号機ロック（pg_advisory_xact_lock）。RPA の結果送信による枯渇切替と
// 同時に走っても直列化され、実行中が2件になることはない。
import { prisma } from "@/lib/prisma";
import { demoteOtherRunning, lockMachine } from "./create";
import { dbDateToYmd, instantToJstYmd, jstTodayYmd } from "./dates";
import { pickQueuedToActivate, shouldCompleteQueued, shouldCompleteRunning, type RolloverRow } from "./rollover";

/** 1号機ぶんの結果。何も起きなければ全部空 */
export type RolloverOutcome = {
  machineId: string;
  /** 日付が変わったため完了（DONE）にした有効（RUNNING）の id */
  completedRunningIds: string[];
  /** 配信日が過ぎたため完了（DONE）にした予約（QUEUED）の id */
  completedQueuedIds: string[];
  /** 新しく有効（RUNNING）にした条件の id */
  activatedId: string | null;
};

// 「配信日が空の有効」を完了にしてよいかは最新実行の日付で決まる（rollover.ts）。それ以外の列は判定に要らない
const rolloverInclude = {
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
 * T-212 以降、ここからは LINE WORKS へ何も送らない（通知は朝のまとめ1通だけ。daily-summary.ts）。
 */
export async function runDateRollover(machineId: string): Promise<RolloverOutcome> {
  const todayYmd = jstTodayYmd();

  const tx = await prisma.$transaction(
    async (t) => {
      await lockMachine(t, machineId);

      // 2-1. 前日以前の有効を完了にする（有効は号機に1件のはずだが、念のため全件を見る）
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

      // 2-2. 配信日が過ぎた予約を完了にする（有効が残っているかどうかに関わらず掃除する）
      const queued = await t.scoutCondition.findMany({ where: { machineId, status: "QUEUED" }, include: rolloverInclude });
      const expired = queued.filter((c) => shouldCompleteQueued(toRolloverRow(c), todayYmd));
      if (expired.length > 0) {
        await t.scoutCondition.updateMany({
          where: { id: { in: expired.map((c) => c.id) } },
          data: { status: "DONE" }, // 通知は出さない（静かに完了にする）
        });
      }

      const base = {
        completedRunningIds: stale.map((c) => c.id),
        completedQueuedIds: expired.map((c) => c.id),
      };

      // 有効が残っているなら（配信日が今日、または未来日付を人が手で有効にした場合）そのまま。予約は上げない
      if (runnings.length > stale.length) return { ...base, activatedId: null };

      // 2-3. 「配信日が今日」の予約のうち ▲▼ 順で一番上を有効にする（該当が無ければ有効なしのまま）
      const next = pickQueuedToActivate(queued.filter((c) => !expired.includes(c)).map(toRolloverRow), todayYmd);
      if (!next) return { ...base, activatedId: null };

      // 配信日は今日ちょうどの行しか選ばないので、deliveryDate はそのまま（補完は不要）
      await t.scoutCondition.update({ where: { id: next.id }, data: { status: "RUNNING" } });
      // T-198: 実行中は号機ごとに1件。上で0件になっているはずだが、念のため畳んでおく
      await demoteOtherRunning(t, machineId, next.id);

      return { ...base, activatedId: next.id };
    },
    { timeout: 20000 },
  );

  return { machineId, ...tx };
}

/**
 * 稼働中の号機をまとめて判定する（一覧を開いたとき用）。
 * 「有効の配信日が今日以降」かつ「期限切れの予約も無い」号機は何も起きないので、先に読みで落としてからロックを取る
 * （毎回全号機ぶんのロックを取らないため）。実際の判定は runDateRollover がロックの中でやり直す。
 */
export async function runDateRolloverForActiveMachines(): Promise<RolloverOutcome[]> {
  const todayYmd = jstTodayYmd();
  const machines = await prisma.rpaScoutMachine.findMany({ where: { isActive: true }, select: { id: true } });
  if (machines.length === 0) return [];

  const machineIds = machines.map((m) => m.id);
  const rows = await prisma.scoutCondition.findMany({
    where: { machineId: { in: machineIds }, status: { in: ["RUNNING", "QUEUED"] } },
    select: { machineId: true, status: true, deliveryDate: true },
  });
  // 配信日が今日以降の有効を持つ号機は 2-1・2-3 では動かない。
  // 配信日が空の有効は最新実行を見ないと判断できないので、ロックを取って runDateRollover に判定させる。
  const settled = new Set(
    rows
      .filter((r) => r.status === "RUNNING" && r.deliveryDate !== null && dbDateToYmd(r.deliveryDate)! >= todayYmd)
      .map((r) => r.machineId),
  );
  // T-211: 有効が今日のままでも、配信日が過ぎた予約（2-2）があれば掃除しに行く
  const hasExpiredQueued = new Set(
    rows
      .filter((r) => r.status === "QUEUED" && r.deliveryDate !== null && dbDateToYmd(r.deliveryDate)! < todayYmd)
      .map((r) => r.machineId),
  );

  const out: RolloverOutcome[] = [];
  for (const machineId of machineIds) {
    if (settled.has(machineId) && !hasExpiredQueued.has(machineId)) continue;
    const r = await runDateRollover(machineId);
    if (r.completedRunningIds.length > 0 || r.completedQueuedIds.length > 0 || r.activatedId) out.push(r);
  }
  return out;
}

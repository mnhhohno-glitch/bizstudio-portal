// T-209 / T-210 / T-211: 日付が変わったときの配信条件の切替。
//
// 運用ルール（T-211 で確定）: **有効になるのは「配信日が今日」の条件だけ**。前日のうちに翌日分を予約しておけば
// 翌朝に自動で有効になる。配信日が過ぎたものは自動で完了。号機ロックの中で次の順に実行する。
//   2-1. 前日以前の有効を完了（DONE）にする
//   2-2. 配信日が過ぎた予約を完了（DONE）にする（通知なし）
//   2-3. 有効が無ければ「配信日が今日」の予約のうち ▲▼ 順で一番上を有効にする
//   2-4. 2-1 で完了にしたのに 2-3 で上げられなかったら「本日の配信条件がありません」を LINE WORKS に1行通知
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
import { conditionLabel } from "./label";
import { sendScoutLine } from "./queue-empty";
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
  /** 2-4 の「本日の配信条件がありません」通知を出したか */
  noConditionNotified: boolean;
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

/** "2026-09-19" → "9/19"（通知文の「本日（9/19）」用。曜日は付けない） */
function shortYmd(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * 1号機ぶんの日付切替。判定はロックの中でやり直すので、呼ぶ前の下読み（有効が無さそう等）が古くなっていても安全。
 * LINE WORKS 通知はトランザクションの外で送る（通知の失敗で DB をロールバックしないため）。
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
      if (runnings.length > stale.length) return { ...base, activated: null, prevLabel: null };

      // 2-3. 「配信日が今日」の予約のうち ▲▼ 順で一番上を有効にする（該当が無ければ有効なしのまま）
      const next = pickQueuedToActivate(
        queued.filter((c) => !expired.includes(c)).map((c) => ({ ...toRolloverRow(c), row: c })),
        todayYmd,
      );
      if (!next) return { ...base, activated: null, prevLabel: null };

      // 配信日は今日ちょうどの行しか選ばないので、deliveryDate はそのまま（補完は不要）
      await t.scoutCondition.update({ where: { id: next.id }, data: { status: "RUNNING" } });
      // T-198: 実行中は号機ごとに1件。上で0件になっているはずだが、念のため畳んでおく
      await demoteOtherRunning(t, machineId, next.id);

      return {
        ...base,
        activated: { id: next.id, label: conditionLabel(next.row) },
        prevLabel: stale.length > 0 ? conditionLabel(stale[0]) : null,
      };
    },
    { timeout: 20000 },
  );

  const machineNo = async () =>
    (await prisma.rpaScoutMachine.findUnique({ where: { id: machineId }, select: { machineNo: true } }))?.machineNo ?? "?";

  // 有効が入れ替わったときだけ1行通知する（枯渇時の通知とは別。文面に「日付切替」を入れて見分けられるようにする）
  if (tx.activated && tx.completedRunningIds.length > 0 && tx.prevLabel) {
    await sendScoutLine(
      `【スカウト】${await machineNo()}号機：日付切替により条件「${tx.prevLabel}」を完了 → 条件「${tx.activated.label}」に切替`,
    );
  }

  // 2-4. 前日の有効を完了にしたのに当日の条件が無い＝その号機は今日配信されない。
  //   通知はこの遷移が起きた1回だけ（有効なしの状態で一覧を何度開いても、2回目以降は 2-1 で完了にする行が無く再送されない）。
  //   ポータルタスクは作らない（枯渇の予約切れタスクと混ざらないようにする）。
  let noConditionNotified = false;
  if (!tx.activated && tx.completedRunningIds.length > 0) {
    noConditionNotified = await sendScoutLine(
      `【スカウト】${await machineNo()}号機：本日（${shortYmd(todayYmd)}）の配信条件がありません。配信は行われません`,
    );
  }

  return {
    machineId,
    completedRunningIds: tx.completedRunningIds,
    completedQueuedIds: tx.completedQueuedIds,
    activatedId: tx.activated?.id ?? null,
    noConditionNotified,
  };
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

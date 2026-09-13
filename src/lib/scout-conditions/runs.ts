// T-195: RPA からの実績受け取り（POST /api/external/scout-conditions/runs）の本体。
//
// 1. scout_runs に記録
// 2. sentCount < 10（DRY_THRESHOLD）なら is_dry=true、条件を DRY に
// 3. その号機の QUEUED を queue_order 昇順で先頭から RUNNING に（delivery_date が空なら当日 JST）
// 4. 切替できた → LINE WORKS に1行通知
// 5. 予約が空 → 枯渇した条件を RUNNING のまま残す（配信は止めない）＋通知＋タスク起票（queue-empty.ts）
// 6. sentCount >= 10 は記録のみ
//
// 冪等: 同じ machineNo＋conditionId＋executedAt（分単位）の再送は新規記録せず既存 run の内容を返す。
// dryRun: 検証と「もし送ったらどうなるか」の計算だけ行い、DB に一切書かない・通知もしない。
// 排他: 号機単位の pg_advisory_xact_lock（$executeRaw。$queryRaw だと void 列で P2010）。
import { prisma } from "@/lib/prisma";
import type { Prisma, RpaScoutMachine } from "@prisma/client";
import { DRY_THRESHOLD, isDrySentCount } from "./constants";
import { jstTodayYmd, ymdToDbDate } from "./dates";
import { conditionLabel } from "./label";
import { handleQueueEmpty, sendScoutLine, type QueueEmptyOutcome } from "./queue-empty";

export type RunInput = {
  machineNo: number;
  conditionId: string;
  executedAt: Date;
  extractedCount: number;
  sentCount: number;
  rawNotification: string | null;
  dryRun: boolean;
};

/** レスポンス（全キー固定。値が無ければ null） */
export type RunResult = {
  ok: boolean;
  runId: string | null;
  isDry: boolean | null;
  switched: boolean;
  currentConditionId: string | null;
  queueEmpty: boolean | null;
  message: string | null;
};

const labelInclude = { template: { select: { name: true } } } satisfies Prisma.ScoutConditionInclude;

function fail(message: string): RunResult {
  return { ok: false, runId: null, isDry: null, switched: false, currentConditionId: null, queueEmpty: null, message };
}

/** 分単位に切り詰めた executedAt の範囲（冪等判定用） */
function minuteWindow(d: Date): { gte: Date; lt: Date } {
  const start = new Date(Math.floor(d.getTime() / 60000) * 60000);
  return { gte: start, lt: new Date(start.getTime() + 60000) };
}

async function currentRunningId(client: Prisma.TransactionClient | typeof prisma, machineId: string): Promise<string | null> {
  const r = await client.scoutCondition.findFirst({
    where: { machineId, status: "RUNNING" },
    orderBy: [{ queueOrder: "asc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  return r?.id ?? null;
}

async function isQueueEmpty(client: Prisma.TransactionClient | typeof prisma, machineId: string): Promise<boolean> {
  const n = await client.scoutCondition.count({ where: { machineId, status: "QUEUED" } });
  return n === 0;
}

export type RecordRunOutcome = RunResult & { queueEmptyOutcome: QueueEmptyOutcome | null };

export async function recordScoutRun(input: RunInput): Promise<RecordRunOutcome> {
  const machine = await prisma.rpaScoutMachine.findUnique({ where: { machineNo: input.machineNo } });
  if (!machine) return { ...fail(`${input.machineNo}号機は存在しません`), queueEmptyOutcome: null };

  const condition = await prisma.scoutCondition.findUnique({ where: { id: input.conditionId }, include: labelInclude });
  if (!condition) return { ...fail("conditionId の条件が見つかりません"), queueEmptyOutcome: null };
  if (condition.machineId !== machine.id) {
    return { ...fail(`conditionId は${input.machineNo}号機の条件ではありません`), queueEmptyOutcome: null };
  }

  const label = conditionLabel(condition);
  const window = minuteWindow(input.executedAt);
  const isDry = isDrySentCount(input.sentCount);

  type TxOut =
    | { kind: "duplicate"; runId: string; existingIsDry: boolean }
    | {
        kind: "recorded";
        runId: string | null;
        switched: boolean;
        nextId: string | null;
        nextLabel: string | null;
        queueEmpty: boolean;
        wasRunning: boolean;
      };

  const tx = await prisma.$transaction(
    async (t): Promise<TxOut> => {
      // 号機単位で直列化（RPA の再試行が同時に届いても二重記録・二重切替しない）
      await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scout-runs:${machine.id}`})::bigint)`;

      const existing = await t.scoutRun.findFirst({
        where: { machineId: machine.id, conditionId: condition.id, executedAt: window },
        orderBy: { createdAt: "asc" },
        select: { id: true, isDry: true },
      });
      if (existing) return { kind: "duplicate", runId: existing.id, existingIsDry: existing.isDry };

      let runId: string | null = null;
      if (!input.dryRun) {
        const run = await t.scoutRun.create({
          data: {
            conditionId: condition.id,
            machineId: machine.id,
            executedAt: input.executedAt,
            extractedCount: input.extractedCount,
            sentCount: input.sentCount,
            isDry,
            rawNotification: input.rawNotification,
          },
          select: { id: true },
        });
        runId = run.id;
      }

      const fresh = await t.scoutCondition.findUnique({ where: { id: condition.id }, select: { status: true } });
      const wasRunning = fresh?.status === "RUNNING";
      const base = { kind: "recorded" as const, runId, switched: false, nextId: null, nextLabel: null, wasRunning };

      if (!wasRunning || !isDry) {
        return { ...base, queueEmpty: await isQueueEmpty(t, machine.id) };
      }

      const next = await t.scoutCondition.findFirst({
        where: { machineId: machine.id, status: "QUEUED" },
        orderBy: [{ queueOrder: "asc" }, { createdAt: "asc" }],
        include: labelInclude,
      });
      if (!next) {
        // 予約が空: 枯渇した条件を RUNNING のまま残す（配信は止めない）
        return { ...base, queueEmpty: true };
      }
      if (!input.dryRun) {
        await t.scoutCondition.update({ where: { id: condition.id }, data: { status: "DRY" } });
        await t.scoutCondition.update({
          where: { id: next.id },
          data: { status: "RUNNING", deliveryDate: next.deliveryDate ?? ymdToDbDate(jstTodayYmd()) },
        });
      }
      const remaining = await t.scoutCondition.count({ where: { machineId: machine.id, status: "QUEUED", id: { not: next.id } } });
      return { ...base, switched: true, nextId: next.id, nextLabel: conditionLabel(next), queueEmpty: remaining === 0 };
    },
    { timeout: 20000 },
  );

  if (tx.kind === "duplicate") {
    const fresh = await prisma.scoutCondition.findUnique({ where: { id: condition.id }, select: { status: true } });
    return {
      ok: true,
      runId: tx.runId,
      isDry: tx.existingIsDry,
      // 既存 run が枯渇扱いで、その条件が既に RUNNING でなければ「切替済み」として返す
      switched: tx.existingIsDry && fresh?.status === "DRY",
      currentConditionId: await currentRunningId(prisma, machine.id),
      queueEmpty: await isQueueEmpty(prisma, machine.id),
      message: `同一内容（号機・条件・実行日時が分単位で一致）の再送のため、記録済みの実績を返します（runId=${tx.runId}）`,
      queueEmptyOutcome: null,
    };
  }

  const prefix = input.dryRun ? "[dryRun] " : "";
  let message: string;
  let queueEmptyOutcome: QueueEmptyOutcome | null = null;

  if (!tx.wasRunning) {
    message = `${prefix}条件「${label}」は RUNNING ではないため記録のみ（枯渇判定・切替はしません）`;
  } else if (!isDry) {
    message = `${prefix}送信${input.sentCount}件（${DRY_THRESHOLD}件以上）のため記録のみ`;
  } else if (tx.switched) {
    message = `${prefix}条件「${label}」が枯渇（送信${input.sentCount}件）→ 条件「${tx.nextLabel}」に切替`;
    if (!input.dryRun) {
      await sendScoutLine(`【スカウト】${machine.machineNo}号機：条件「${label}」が枯渇（送信${input.sentCount}件）→ 条件「${tx.nextLabel}」に切替`);
    }
  } else {
    message = `${prefix}条件「${label}」が枯渇（送信${input.sentCount}件）。予約が空のため RUNNING のまま配信を続けます`;
    if (!input.dryRun) {
      queueEmptyOutcome = await handleQueueEmpty({ machine: machine as RpaScoutMachine, condition, sentCount: input.sentCount });
      if (queueEmptyOutcome.taskCreated) message += `（タスク起票: ${queueEmptyOutcome.taskId}）`;
    }
  }

  const currentConditionId = input.dryRun
    ? tx.switched
      ? tx.nextId
      : await currentRunningId(prisma, machine.id)
    : await currentRunningId(prisma, machine.id);

  return {
    ok: true,
    runId: tx.runId,
    isDry,
    switched: tx.switched,
    currentConditionId,
    queueEmpty: tx.queueEmpty,
    message,
    queueEmptyOutcome,
  };
}

/** リクエストボディの検証。executedAt は TZ 無しなら JST として解釈（罠#17）。null なら受信時刻。 */
export function parseRunInput(body: unknown): { ok: true; data: RunInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "リクエストボディが不正です" };
  const b = body as Record<string, unknown>;

  const machineNo = typeof b.machineNo === "string" ? Number(b.machineNo) : b.machineNo;
  if (typeof machineNo !== "number" || !Number.isInteger(machineNo)) return { ok: false, error: "machineNo は整数で指定してください" };

  if (typeof b.conditionId !== "string" || !b.conditionId.trim()) return { ok: false, error: "conditionId は必須です" };

  const executedAt = parseExecutedAt(b.executedAt);
  if (executedAt === undefined) return { ok: false, error: "executedAt の日時形式が不正です" };

  const toCount = (v: unknown, name: string): number | string => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (n == null) return 0;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return `${name} は0以上の整数で指定してください`;
    return n;
  };
  const extractedCount = toCount(b.extractedCount, "extractedCount");
  if (typeof extractedCount === "string") return { ok: false, error: extractedCount };
  const sentCount = toCount(b.sentCount, "sentCount");
  if (typeof sentCount === "string") return { ok: false, error: sentCount };
  if (b.sentCount == null) return { ok: false, error: "sentCount は必須です" };

  const rawNotification = b.rawNotification == null ? null : String(b.rawNotification);
  const dryRun = b.dryRun === true || b.dryRun === "true";

  return {
    ok: true,
    data: {
      machineNo,
      conditionId: b.conditionId.trim(),
      executedAt: executedAt ?? new Date(),
      extractedCount,
      sentCount,
      rawNotification,
      dryRun,
    },
  };
}

/**
 * executedAt の解釈。undefined=不正、null=未指定。
 *  - "2026-09-14T10:02:00+09:00" / "...Z" → その表記に従う
 *  - "2026-09-14T10:02:00" / "2026-09-14 10:02:00" / "2026/09/14 10:02:00" → JST の壁時計値として +09:00 を付ける
 */
export function parseExecutedAt(v: unknown): Date | null | undefined {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return undefined;
  let s = v.trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(.*)$/);
  if (!m) return undefined;
  const [, y, mo, d, h = "0", mi = "0", sec = "0", tail] = m;
  const p = (n: string) => n.padStart(2, "0");
  const tz = tail.trim();
  const hasTz = /^([zZ]|[+-]\d{2}:?\d{2})$/.test(tz);
  if (tz && !hasTz && !/^\.\d+$/.test(tz)) return undefined;
  s = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(sec)}${hasTz ? tz : "+09:00"}`;
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

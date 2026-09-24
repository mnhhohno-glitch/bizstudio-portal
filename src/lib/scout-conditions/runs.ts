// T-195: RPA からの実績受け取り（POST /api/external/scout-conditions/runs）の本体。
//
// 1. scout_runs に記録
// 2. sentCount < 10（DRY_THRESHOLD）なら is_dry=true
// 3. その号機の QUEUED のうち **配信日が今日（JST）のもの**を queue_order 昇順で先頭から RUNNING に
//    （T-211。候補の絞り込みだけ日付切替〔rollover.ts の pickQueuedToActivate〕と同じ規則に揃えた）。
//    切替元は DONE（完了）にする（T-205。使い終わった条件なので「完了」。枯渇だったことは最新実行の is_dry から出る「枯渇」バッジで分かる）
// 4. 切替できた → LINE WORKS に1行通知
// 5. 配信日が今日の予約が無い → 枯渇した条件を RUNNING のまま残す（配信は止めない）＋通知＋タスク起票（queue-empty.ts）
//    ※通知・タスクの文面は「予約が空」のまま（T-211 で変えたのは候補の絞り込みだけ。queue-empty.ts は不変）
// 6. sentCount >= 10 は記録のみ
//
// 冪等: 同じ machineNo＋conditionId＋executedAt（分単位）の再送は新規記録せず既存 run の内容を返す。
// dryRun: 検証と「もし送ったらどうなるか」の計算だけ行い、DB に一切書かない・通知もしない。
// 排他: 号機単位の pg_advisory_xact_lock（$executeRaw。$queryRaw だと void 列で P2010）。
import { prisma } from "@/lib/prisma";
import type { Prisma, RpaScoutMachine } from "@prisma/client";
import { DRY_THRESHOLD, isDrySentCount } from "./constants";
import { demoteOtherRunning } from "./create";
import { dbDateToYmd, jstTodayYmd } from "./dates";
import { conditionLabel } from "./label";
import { handleQueueEmpty, sendScoutLine, type QueueEmptyOutcome } from "./queue-empty";
import { pickQueuedToActivate } from "./rollover";

export type RunInput = {
  machineNo: number;
  conditionId: string;
  executedAt: Date;
  extractedCount: number;
  sentCount: number;
  /** T-206: マイナビの検索結果件数（母数）。RPA が送ってこない・数値に直せない場合は null */
  searchResultCount: number | null;
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
            searchResultCount: input.searchResultCount,
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

      // T-211: 次に有効にする候補は「配信日が今日の予約」だけ（▲▼ 順の一番上）。日付切替（activate.ts）と同じ規則。
      //   枯渇のしきい値・is_dry の計算・下の「予約が空」通知とタスク起票は変えていない（候補の絞り込みだけ）。
      const queued = await t.scoutCondition.findMany({
        where: { machineId: machine.id, status: "QUEUED" },
        include: labelInclude,
      });
      const picked = pickQueuedToActivate(
        queued.map((c) => ({
          id: c.id,
          deliveryYmd: dbDateToYmd(c.deliveryDate),
          queueOrder: c.queueOrder,
          createdAtIso: c.createdAt.toISOString(),
          lastRunYmd: null,
          row: c,
        })),
        jstTodayYmd(),
      );
      const next = picked?.row ?? null;
      if (!next) {
        // 配信日が今日の予約が無い: 枯渇した条件を RUNNING のまま残す（配信は止めない）
        return { ...base, queueEmpty: true };
      }
      if (!input.dryRun) {
        // T-205: 次の条件に切り替わった時点でこの条件は使い終わり。以前は DRY（枯渇）のまま残していたが、
        //   まだ配信中に見えるため DONE（完了）にする。一覧では最新実行が送信10件未満なので「完了」＋「枯渇」が並ぶ。
        //   予約が空で切り替わらなかったときは上の分岐で return しており、RUNNING のまま配信を続ける（据え置き）。
        await t.scoutCondition.update({ where: { id: condition.id }, data: { status: "DONE" } });
        // T-211: 配信日が今日ちょうどの行しか選ばないので deliveryDate の補完は不要
        await t.scoutCondition.update({ where: { id: next.id }, data: { status: "RUNNING" } });
        // T-198: 実行中は号機ごとに1件。切替元は上で DONE にしているので通常は0件だが、念のため他の RUNNING を畳む
        await demoteOtherRunning(t, machine.id, next.id);
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
      // （切替元は T-205 で DRY → DONE に変わったが、旧データの DRY や手で完了にした行も同じ「RUNNING でない」で拾える）
      switched: tx.existingIsDry && fresh?.status !== "RUNNING",
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

  // T-206: 検索結果件数は任意項目。数値に直せなくても結果送信そのものは失敗させない（null で保存して警告だけ出す）
  const searchResult = parseSearchResultCount(b.searchResultCount);
  if (searchResult.invalidRaw != null) {
    console.warn(`[scout-conditions/runs] searchResultCount を数値に直せませんでした: ${searchResult.invalidRaw.slice(0, 50)}`);
  }

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
      searchResultCount: searchResult.value,
      rawNotification,
      dryRun,
    },
  };
}

/**
 * T-206: 検索結果件数（マイナビの「検索結果：全1299件」の数字）の掃除。
 * RPA は画面から取った文字列をそのまま送ってくるため "1,299" / "1,299件" / "1299 件" / "全1,299件" の形で届き得る。
 * カンマ・「件」・空白（全角含む）を落とし、全角数字は半角に直してから数値にする。
 * 数値に直せなければ value=null・invalidRaw=受け取った原文（呼び出し側が console.warn に先頭50文字を出す）。
 * 未指定・空文字は「送ってきていない」だけなので警告は出さない（RPA 未改修の間はこちらが通常）。
 */
export function parseSearchResultCount(v: unknown): { value: number | null; invalidRaw: string | null } {
  if (v == null || v === "") return { value: null, invalidRaw: null };
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 0 ? { value: v, invalidRaw: null } : { value: null, invalidRaw: String(v) };
  }
  if (typeof v !== "string") return { value: null, invalidRaw: String(v) };
  const cleaned = v
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，、\s　]/g, "")
    .replace(/件/g, "");
  // 掃除した後に数字だけ、または数字のかたまりが1つだけ（「全1299」「検索結果：1299」）なら受ける
  const m = cleaned.match(/^\D*(\d+)\D*$/);
  if (!m) return { value: null, invalidRaw: v };
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? { value: n, invalidRaw: null } : { value: null, invalidRaw: v };
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

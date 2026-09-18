// T-212: 朝の「本日の配信条件」まとめ通知（1日1通）。
//
// 背景: T-210/T-211 は日付切替のたびに「条件Aを完了 → 条件Bに切替」を号機ごとに LINE WORKS へ送っていた。
//   1号機の夜間フローが 5:00 に条件を取りに来るため通知が早朝に飛び、しかも完了した条件が無い号機には出ない。
//   運用の求めは「RPA が動き出す 8 時前後に、全号機の本日の配信条件を1通にまとめて」。以降は枯渇通知だけでよい。
//
// 送るタイミング: GET /api/external/scout-conditions/current が **その日（JST）の 07:00 以降に最初に呼ばれたとき**、
//   日付切替処理（activate.ts）を終えたあと。07:00 より前の呼び出し（1号機の夜間フロー 5:00）では送らない
//   （この時点でも日付切替そのものは従来どおり走る）。RPA が一度も動かない日は送られない。
//
// 1日1回の担保: scout_daily_notifications に「その日の行」を INSERT できた呼び出しだけが送る。
//   ON CONFLICT DO NOTHING（createMany の skipDuplicates）1文なので、複数号機が同時に取りに来ても
//   主キーの一意制約で必ず1つに絞られる（後続は count=0 で送らない）。
//
// 通知の失敗で RPA を止めないため、この経路は絶対に throw しない（失敗は console.warn に残すだけ）。
import { prisma } from "@/lib/prisma";
import { runDateRolloverForActiveMachines } from "./activate";
import { formatRecordNo } from "./constants";
import { jstNowHour, jstTodayYmd, ymdToDbDate, ymdWeekdayLabel } from "./dates";
import { conditionLabel } from "./label";
import { sendScoutLine } from "./queue-empty";

/** この時刻（JST の「時」）以降の最初の /current 呼び出しで送る */
export const DAILY_SUMMARY_FROM_HOUR = 7;

/** 通知1行ぶん。号機と、その号機で「有効」になっている条件（無ければ null） */
export type DailySummaryLine = {
  machineNo: number;
  /** 条件の要約（既存の conditionLabel）。有効が無ければ null */
  label: string | null;
  /** レコード番号「1-017」。採番前なら null */
  recordNo: string | null;
};

/** "2026-09-19" → "9/19 土"（通知見出し用） */
function headerYmd(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)} ${ymdWeekdayLabel(ymd)}`;
}

/**
 * まとめ通知の文面を組み立てる純関数（DB も現在時刻も見ない。todayYmd は JST の "YYYY-MM-DD"）。
 * lines は号機番号の昇順で渡す。テンプレート名は入れない（長くなるため）。
 *
 * 例:
 *   【スカウト】本日（9/19 土）の配信条件が有効になりました
 *   1号機: 未送信/7日以内/卒15-26/～3社/全国（1-017）
 *   5号機: 条件なし
 */
export function buildDailySummaryMessage(todayYmd: string, lines: DailySummaryLine[]): string {
  const head = `【スカウト】本日（${headerYmd(todayYmd)}）の配信条件が有効になりました`;
  const body = lines.map((l) => {
    if (l.label === null) return `${l.machineNo}号機: 条件なし`;
    return `${l.machineNo}号機: ${l.label}${l.recordNo ? `（${l.recordNo}）` : ""}`;
  });
  return [head, ...body].join("\n");
}

/**
 * 稼働中（isActive）の号機を号機番号順に並べ、その号機で「有効」（RUNNING）になっている条件を1行ぶんに直す。
 * 有効が複数ある号機（起きない想定）は findRunningCondition と同じ並び（queueOrder 昇順 → 更新が新しい順）の先頭を採る。
 */
export async function collectDailySummaryLines(): Promise<DailySummaryLine[]> {
  const machines = await prisma.rpaScoutMachine.findMany({
    where: { isActive: true },
    orderBy: { machineNo: "asc" },
    select: { id: true, machineNo: true },
  });
  if (machines.length === 0) return [];

  const runnings = await prisma.scoutCondition.findMany({
    where: { machineId: { in: machines.map((m) => m.id) }, status: "RUNNING" },
    include: { template: { select: { name: true } } },
    orderBy: [{ queueOrder: "asc" }, { updatedAt: "desc" }],
  });

  return machines.map((m) => {
    const c = runnings.find((r) => r.machineId === m.id);
    if (!c) return { machineNo: m.machineNo, label: null, recordNo: null };
    return { machineNo: m.machineNo, label: conditionLabel(c), recordNo: formatRecordNo(m.machineNo, c.seqNo) };
  });
}

/**
 * その日の通知枠を取る。INSERT できたら true（＝この呼び出しが送る）、既に行があれば false。
 * 1文の ON CONFLICT DO NOTHING なので、同時に2号機が取りに来ても片方しか true にならない。
 */
async function claimToday(todayYmd: string): Promise<boolean> {
  const r = await prisma.scoutDailyNotification.createMany({
    data: [{ date: ymdToDbDate(todayYmd) }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

export type DailySummaryOutcome = {
  /** 通知枠を取れた（この呼び出しが送信担当になった）か */
  claimed: boolean;
  /** LINE WORKS へ送れたか */
  sent: boolean;
  /** 送った（または組み立てた）文面。送らなかったときは null */
  message: string | null;
};

const SKIPPED: DailySummaryOutcome = { claimed: false, sent: false, message: null };

/**
 * 07:00 以降の最初の呼び出しなら、全号機ぶんのまとめを1通送る。
 * 呼び出し口は GET /api/external/scout-conditions/current（external.ts）のみ。
 * 失敗しても throw しない（RPA のレスポンスは正常に返す）。
 */
export async function notifyDailySummaryIfDue(): Promise<DailySummaryOutcome> {
  try {
    if (jstNowHour() < DAILY_SUMMARY_FROM_HOUR) return SKIPPED;
    const todayYmd = jstTodayYmd();
    if (!(await claimToday(todayYmd))) return SKIPPED;

    // 呼んできた号機以外は、まだその日の切替を通っていないことがある（前日の条件のまま出てしまう）。
    // 文面を作る前に全号機ぶんの切替を通しておく（判定は activate.ts のまま。ここでロジックは足さない）。
    await runDateRolloverForActiveMachines();

    const lines = await collectDailySummaryLines();
    if (lines.length === 0) return { claimed: true, sent: false, message: null }; // 稼働中の号機が無い日は送らない

    const message = buildDailySummaryMessage(todayYmd, lines);
    const sent = await sendScoutLine(message);
    if (!sent) console.warn("[scout-conditions] 本日の配信条件のまとめ通知を送れませんでした:", message);
    return { claimed: true, sent, message };
  } catch (e) {
    console.warn("[scout-conditions] 本日の配信条件のまとめ通知に失敗:", e);
    return SKIPPED;
  }
}

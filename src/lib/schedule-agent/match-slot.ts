// T-139 step3: 日程調整AIエージェント 共通コア（空き枠マッチング）。
// 夜間バッチ（/api/internal/schedule-agent/run）と外部受け口（/api/external/schedule-agent/resolve）の両方から呼ぶ。
//
// 枠ルール（将幸さん確定）:
//   - Q1/Q3: 希望時間帯の「開始時刻から60分」を固定で取る（希望幅が60分より長くても短くても同じ）。
//   - 開始は 9:00〜20:00 の範囲内。
//   - 当日は不可（翌営業日以降）。土日祝は枠にしない（isBusinessDay）。
//   - 翌営業日〜2週間（14日）以内。
//   - Q2: 対象CAは env SCHEDULE_AGENT_TARGET_USER_IDS（カンマ区切り・ハードコードしない）。
//         3名のうち誰か1人でも空いていれば「空き」。複数空いていれば env リストの先頭順で1名を採用。
//
// フェイルセーフ: getCalendarEvents は「カレンダー未接続」でも [] を返す（＝終日空きに見える）。
//   未接続CAに誤って割り当てないよう、GoogleCalendarConnection がある userId だけを判定対象にする。
// 既知の制限: getCalendarEvents は終日イベント（start.date のみ）を除外するため、終日の予定（有給等）は
//   ブロック要因にならない。仮予約は「人が翌営業日に最終割り当てする仮置き」のため許容する。
import { getCalendarEvents } from "@/lib/googleCalendar";
import { isBusinessDay } from "@/lib/attendance/business-days";
import { prisma } from "@/lib/prisma";

/** 1枠の長さ（分）。Q1/Q3: 希望の開始時刻から常にこの長さを取る。 */
export const SLOT_MINUTES = 60;
/** 開始時刻の許容範囲（分）。9:00〜20:00。 */
export const EARLIEST_START_MIN = 9 * 60;
export const LATEST_START_MIN = 20 * 60;
/** 探索の地平線（日）。翌営業日〜この日数以内。 */
export const HORIZON_DAYS = 14;

/** 希望日時1件（date=YYYY-MM-DD(JST) / startTime,endTime="HH:MM"）。 */
export type DesiredSlot = {
  label: string; // "第1希望" 等（仮予約タイトルに載せる）
  date: string;
  startTime: string;
  endTime: string;
};

/** 確保できた枠（担当候補CA付き）。 */
export type MatchedSlot = {
  date: string;
  startTime: string;
  endTime: string;
  userId: string;
  userName: string;
  desired: DesiredSlot;
};

export type MatchResult = { matched: MatchedSlot | null; reason?: string };

export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** JST の今日（YYYY-MM-DD）。Railway 本番は UTC のため必ず timeZone 指定で取る（Pitfall #17）。 */
export function jstTodayYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** YYYY-MM-DD に日数を加算（UTC 固定で計算＝ローカルTZに影響されない）。 */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** JST 暦日が営業日（平日かつ非祝日）か。business-days.ts の isBusinessDay を再利用。 */
export function isBusinessDayYmd(ymd: string): boolean {
  return isBusinessDay(new Date(`${ymd}T00:00:00+09:00`));
}

/** fromYmd の翌営業日。 */
export function nextBusinessDayYmd(fromYmd: string): string {
  let d = addDaysYmd(fromYmd, 1);
  for (let i = 0; i < 30; i++) {
    if (isBusinessDayYmd(d)) return d;
    d = addDaysYmd(d, 1);
  }
  return d;
}

/** Q2: 空き判定の対象CA（env・カンマ区切り・先頭順が採用優先順）。 */
export function getTargetUserIds(): string[] {
  return (process.env.SCHEDULE_AGENT_TARGET_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 枠ルール適合判定（当日不可・翌営業日〜2週間・営業日・開始9:00〜20:00）。 */
export function isSlotAllowed(d: DesiredSlot, now: Date = new Date()): boolean {
  const today = jstTodayYmd(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return false;
  if (d.date <= today) return false; // 当日以前は不可
  if (!isBusinessDayYmd(d.date)) return false; // 土日祝は不可
  if (d.date > addDaysYmd(today, HORIZON_DAYS)) return false; // 2週間以内
  const s = toMin(d.startTime);
  if (Number.isNaN(s)) return false;
  if (s < EARLIEST_START_MIN || s > LATEST_START_MIN) return false;
  return true;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** userId → 表示名（Employee 名優先）。仮予約イベントに載せる担当候補CA名。 */
async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, employee: { select: { name: true } } },
  });
  return new Map(users.map((u) => [u.id, u.employee?.name ?? u.name]));
}

/** カレンダー接続済みの userId のみに絞る（未接続を「終日空き」と誤判定しないため）。 */
async function filterConnected(userIds: string[]): Promise<string[]> {
  const conns = await prisma.googleCalendarConnection.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true },
  });
  const connected = new Set(conns.map((c) => c.userId));
  return userIds.filter((id) => connected.has(id)); // env の順序を保つ＝採用優先順を維持
}

/**
 * 希望候補を第1→第2→第3の順に試し、最初に確保できた枠を返す。
 * 各希望について対象CAを env 先頭順に見て、最初に空いていたCAを担当候補として採用する。
 */
export async function matchSlot(
  desired: DesiredSlot[],
  now: Date = new Date()
): Promise<MatchResult> {
  const targets = getTargetUserIds();
  if (targets.length === 0) return { matched: null, reason: "no target CA configured" };

  const connected = await filterConnected(targets);
  if (connected.length === 0) return { matched: null, reason: "no connected CA calendar" };

  const names = await resolveUserNames(connected);

  for (const d of desired) {
    if (!isSlotAllowed(d, now)) continue;

    const start = toMin(d.startTime);
    const end = start + SLOT_MINUTES; // Q1/Q3: 開始時刻から60分固定

    for (const uid of connected) {
      const events = await getCalendarEvents(uid, d.date);
      const busy = events.some((e) => {
        const es = toMin(e.start);
        const ee = toMin(e.end);
        if (Number.isNaN(es) || Number.isNaN(ee)) return false;
        return overlaps(start, end, es, ee);
      });
      if (!busy) {
        return {
          matched: {
            date: d.date,
            startTime: toHHMM(start),
            endTime: toHHMM(end),
            userId: uid,
            userName: names.get(uid) ?? uid,
            desired: d,
          },
        };
      }
    }
  }

  return { matched: null, reason: "no free slot" };
}

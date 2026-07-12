// T-139 step4: 空き枠探索（共通コア）。モードA・モードB の両方から呼ぶ。
//
// 枠ルール:
//   - 60分枠。開始は 9:00〜20:00（20:00開始が最終＝20:00〜21:00 まで可）。
//   - 当日不可。翌営業日〜2週間以内のみ。土日祝は不可（isBusinessDay）。
//   - 幅のある希望（17:00〜20:00）は幅の中の最も早い60分枠から順に試す（30分刻み）。
//   - 幅が60分未満（17:00〜17:30）は開始時刻から後ろへ広げて60分にする（17:00〜18:00）。
//
// 空き判定:
//   - 対象CA（env）のうち **カレンダー連携が生きている** CA だけを見る。
//     getCalendarEvents は未接続でも [] を返す（＝終日空きに見える）ため、接続レコードが無いCAは対象から除外する。
//   - 誰か1人でも空いていればその枠はOK。**どのCAが空いていたかは選ばない・記録しない**（担当割当は翌朝人間が行う）。
//
// 同一枠の多重仮予約の上限:
//   - 仮予約カレンダーはCA個人カレンダーに映らないため、空き判定だけだと同じ枠に別候補者の仮予約が無限に積める。
//   - そこで「その枠に既にある仮予約イベント数 ≧ その枠で空いているCA人数」なら埋まり扱いにして次の枠を探す。
import { prisma } from "@/lib/prisma";
import { getCalendarEvents } from "@/lib/googleCalendar";
import {
  EARLIEST_START_MIN,
  LATEST_START_MIN,
  HORIZON_DAYS,
  SLOT_MINUTES,
  addDaysYmd,
  isBusinessDayYmd,
  jstYmd,
  toHHMM,
  toMin,
} from "./jst";

/** 希望の時間帯（endTime は null 可＝開始のみ指定）。 */
export type DesiredWindow = { date: string; startTime: string; endTime: string | null };

/** 確保対象の60分枠。 */
export type Slot = { date: string; startTime: string; endTime: string };

/** 仮予約カレンダーの既存イベント（枠の占有数カウント用）。 */
export type ReservedEvent = { date: string; startMin: number; endMin: number; summary: string };

export type MatchOutcome =
  | { kind: "reserved"; slot: Slot }
  | { kind: "today_only" }
  | { kind: "unavailable" };

function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

/** 希望の時間帯から候補60分枠を生成する（早い順）。 */
export function slotsFromWindow(w: DesiredWindow): Slot[] {
  const start = toMin(w.startTime);
  if (Number.isNaN(start)) return [];

  const rawEnd = w.endTime ? toMin(w.endTime) : NaN;
  // 終了未指定 or 幅60分未満 → 開始から後ろへ広げて60分にする
  const winEnd =
    Number.isNaN(rawEnd) || rawEnd - start < SLOT_MINUTES ? start + SLOT_MINUTES : rawEnd;

  const slots: Slot[] = [];
  for (let s = start; s + SLOT_MINUTES <= winEnd; s += 30) {
    if (s < EARLIEST_START_MIN || s > LATEST_START_MIN) continue;
    slots.push({ date: w.date, startTime: toHHMM(s), endTime: toHHMM(s + SLOT_MINUTES) });
  }
  return slots;
}

/** カレンダー連携が生きている対象CAだけに絞る（未接続を「空き」と誤判定しないため）。 */
export async function resolveConnectedTargets(targetUserIds: string[]): Promise<string[]> {
  if (targetUserIds.length === 0) return [];
  const conns = await prisma.googleCalendarConnection.findMany({
    where: { userId: { in: targetUserIds } },
    select: { userId: true },
  });
  const connected = new Set(conns.map((c) => c.userId));
  return targetUserIds.filter((id) => connected.has(id)); // env の順序を保つ
}

/** 希望を「当日 / 範囲内の将来 / 範囲外」に振り分ける。 */
export function classifyWindows(
  windows: DesiredWindow[],
  now: Date
): { today: DesiredWindow[]; inRange: DesiredWindow[]; outOfRange: DesiredWindow[] } {
  const todayYmd = jstYmd(now);
  const maxYmd = addDaysYmd(todayYmd, HORIZON_DAYS);

  const res = {
    today: [] as DesiredWindow[],
    inRange: [] as DesiredWindow[],
    outOfRange: [] as DesiredWindow[],
  };
  for (const w of windows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date)) {
      res.outOfRange.push(w);
    } else if (w.date === todayYmd) {
      res.today.push(w); // 当日は個別にスキップ（将来希望が取れればそれで reserved）
    } else if (w.date < todayYmd || w.date > maxYmd || !isBusinessDayYmd(w.date)) {
      res.outOfRange.push(w); // 過去・2週間超・土日祝
    } else {
      res.inRange.push(w);
    }
  }
  return res;
}

/**
 * 希望を順に試し、最初に確保できる枠を返す。
 *   reserved    … 確保できる枠あり
 *   today_only  … 範囲内の将来希望が1つも無く、当日希望のみだった
 *   unavailable … 範囲内の将来希望を全部見て空き無し／全希望が範囲外／対象CA0名
 */
export async function findAvailableSlot(
  windows: DesiredWindow[],
  targetUserIds: string[],
  reservedEvents: ReservedEvent[],
  now: Date
): Promise<MatchOutcome> {
  const connected = await resolveConnectedTargets(targetUserIds);
  if (connected.length === 0) return { kind: "unavailable" };

  const { today, inRange } = classifyWindows(windows, now);

  if (inRange.length === 0) {
    // 将来の探索対象ゼロ。当日希望だけなら today_only、それ以外（範囲外のみ）は unavailable。
    return today.length > 0 ? { kind: "today_only" } : { kind: "unavailable" };
  }

  // (userId, date) → 予定 のキャッシュ（同じ日を何度も叩かない）
  const cache = new Map<string, { start: number; end: number }[]>();
  const eventsOf = async (userId: string, date: string) => {
    const key = `${userId}|${date}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const evs = await getCalendarEvents(userId, date);
    const parsed = evs
      .map((e) => ({ start: toMin(e.start), end: toMin(e.end) }))
      .filter((e) => !Number.isNaN(e.start) && !Number.isNaN(e.end));
    cache.set(key, parsed);
    return parsed;
  };

  for (const w of inRange) {
    for (const slot of slotsFromWindow(w)) {
      const s = toMin(slot.startTime);
      const e = toMin(slot.endTime);

      // その枠で空いているCA人数（誰か1人でも空いていればOK・誰かは選ばない）
      let freeCount = 0;
      for (const uid of connected) {
        const evs = await eventsOf(uid, slot.date);
        if (!evs.some((ev) => overlaps(s, e, ev.start, ev.end))) freeCount++;
      }
      if (freeCount === 0) continue;

      // 多重仮予約の上限: 既にこの枠に入っている仮予約数 ≧ 空きCA人数 なら埋まり扱い
      const reservedCount = reservedEvents.filter(
        (r) => r.date === slot.date && overlaps(s, e, r.startMin, r.endMin)
      ).length;
      if (reservedCount >= freeCount) continue;

      return { kind: "reserved", slot };
    }
  }

  return { kind: "unavailable" };
}

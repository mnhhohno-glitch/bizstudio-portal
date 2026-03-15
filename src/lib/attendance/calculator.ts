import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { DailyTotals } from "./types";

dayjs.extend(utc);
dayjs.extend(timezone);

type TimeRange = { start: number; end: number }; // Unix秒

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = { dailyAttendance: any; };

/**
 * 2つの時間区間の重複秒数を計算
 */
function overlapSeconds(a: TimeRange, b: TimeRange): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
}

/**
 * 退勤確定時に呼び出す日次集計計算
 * @param db - Prismaクライアントまたはトランザクション
 */
export async function calculateDailyTotals(
  dailyAttendanceId: string,
  db?: PrismaLike
): Promise<DailyTotals> {
  const client = db ?? prisma;
  const attendance = await client.dailyAttendance.findUnique({
    where: { id: dailyAttendanceId },
    include: { punchEvents: { orderBy: { timestamp: "asc" } } },
  });

  if (!attendance || !attendance.clockIn || !attendance.clockOut) {
    throw new Error("出退勤データが不完全です");
  }

  const punches: { type: string; timestamp: Date }[] = attendance.punchEvents;
  const clockInTs = dayjs(attendance.clockIn).tz("Asia/Tokyo");
  const clockOutTs = dayjs(attendance.clockOut).tz("Asia/Tokyo");

  // 休憩ペア集計
  const breakStarts = punches.filter((p) => p.type === "BREAK_START");
  const breakEnds = punches.filter((p) => p.type === "BREAK_END");
  let totalBreak = 0;
  const breakRanges: TimeRange[] = [];
  for (let i = 0; i < Math.min(breakStarts.length, breakEnds.length); i++) {
    const s = dayjs(breakStarts[i].timestamp).unix();
    const e = dayjs(breakEnds[i].timestamp).unix();
    totalBreak += e - s;
    breakRanges.push({ start: s, end: e });
  }

  // 中断ペア集計
  const intStarts = punches.filter((p) => p.type === "INTERRUPT_START");
  const intEnds = punches.filter((p) => p.type === "INTERRUPT_END");
  let totalInterrupt = 0;
  const intRanges: TimeRange[] = [];
  for (let i = 0; i < Math.min(intStarts.length, intEnds.length); i++) {
    const s = dayjs(intStarts[i].timestamp).unix();
    const e = dayjs(intEnds[i].timestamp).unix();
    totalInterrupt += e - s;
    intRanges.push({ start: s, end: e });
  }

  // 実労働時間
  const grossWork = clockOutTs.diff(clockInTs, "second");
  const totalWork = Math.max(0, grossWork - totalBreak - totalInterrupt);

  // 残業時間（8時間 = 28800秒 超過分）
  const overtime = Math.max(0, totalWork - 28800);
  // 残業丸め（分単位切り捨て: 秒部分を除去）
  const overtimeRounded = Math.floor(overtime / 60) * 60;

  // 深夜時間計算（22:00〜翌5:00）
  const nightTime = calculateNightTime(
    clockInTs.unix(),
    clockOutTs.unix(),
    [...breakRanges, ...intRanges],
    clockInTs
  );

  // 備考
  const breakCount = Math.min(breakStarts.length, breakEnds.length);
  const note = breakCount >= 2 ? `休憩${breakCount}回` : null;

  return {
    totalBreak,
    totalInterrupt,
    totalWork,
    overtime,
    overtimeRounded,
    nightTime,
    note,
  };
}

/**
 * 深夜時間を計算（22:00〜翌5:00の勤務時間）
 * 休憩・中断区間は除外する
 */
function calculateNightTime(
  clockInUnix: number,
  clockOutUnix: number,
  excludeRanges: TimeRange[],
  clockInDayjs: dayjs.Dayjs
): number {
  // 当日の深夜帯: 22:00〜翌5:00
  const nightStart = clockInDayjs.startOf("day").add(22, "hour").unix();
  const nightEnd = clockInDayjs.startOf("day").add(29, "hour").unix(); // 翌5:00

  const nightRange: TimeRange = { start: nightStart, end: nightEnd };
  const workRange: TimeRange = { start: clockInUnix, end: clockOutUnix };

  // 全体の深夜帯と勤務時間の重複
  let nightSeconds = overlapSeconds(workRange, nightRange);

  // 休憩・中断と深夜帯の重複を除外
  for (const exclude of excludeRanges) {
    nightSeconds -= overlapSeconds(exclude, nightRange);
  }

  return Math.max(0, nightSeconds);
}

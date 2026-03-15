import { prisma } from "@/lib/prisma";
import { toJST, dayjs, TZ } from "./timezone";

export type RecordStatus = "WORKING" | "FINISHED" | "NOT_STARTED" | "PAID_LEAVE" | "CORRECTED";

export type MonthlyRecord = {
  date: string;              // "YYYY-MM-DD"
  day: number;               // 1-31
  dayOfWeek: string;         // "月" etc
  dayOfWeekNum: number;      // 0=日, 6=土
  status: RecordStatus;
  clockIn: string | null;
  clockOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  totalBreak: string;
  totalInterrupt: string;
  overtime: string;
  totalWork: string;
  nightTime: string;
  totalBreakSec: number;
  totalInterruptSec: number;
  overtimeSec: number;
  totalWorkSec: number;
  nightTimeSec: number;
};

export type MonthlySummary = {
  totalBreak: number;
  totalInterrupt: number;
  totalOvertime: number;
  totalWork: number;
  totalNightTime: number;
  workDays: number;
  paidLeaveDays: number;
  offDays: number;
};

function formatHM(seconds: number): string {
  if (seconds === 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatClockTime(dt: Date | null): string | null {
  if (!dt) return null;
  return toJST(dt).format("H:mm");
}

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

export async function getMonthlyRecords(
  employeeId: string,
  year: number,
  month: number
): Promise<{ records: MonthlyRecord[]; summary: MonthlySummary }> {
  const monthStart = dayjs.tz(`${year}-${String(month).padStart(2, "0")}-01`, TZ);
  const daysInMonth = monthStart.daysInMonth();
  const monthStartDB = new Date(monthStart.format("YYYY-MM-DD") + "T00:00:00.000Z");
  const monthEndDB = new Date(monthStart.endOf("month").format("YYYY-MM-DD") + "T00:00:00.000Z");

  const [attendances, leaves, corrections] = await Promise.all([
    prisma.dailyAttendance.findMany({
      where: { employeeId, date: { gte: monthStartDB, lte: monthEndDB } },
      include: { punchEvents: { orderBy: { timestamp: "asc" } } },
      orderBy: { date: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId, targetDate: { gte: monthStartDB, lte: monthEndDB }, status: "APPROVED" },
    }),
    prisma.modificationRequest.findMany({
      where: { employeeId, targetDate: { gte: monthStartDB, lte: monthEndDB }, status: "APPROVED" },
    }),
  ]);

  const attMap = new Map(attendances.map((a) => [toJST(a.date).format("YYYY-MM-DD"), a]));
  const leaveSet = new Set(leaves.map((l) => toJST(l.targetDate).format("YYYY-MM-DD")));
  const corrSet = new Set(corrections.map((c) => toJST(c.targetDate).format("YYYY-MM-DD")));

  const records: MonthlyRecord[] = [];
  const summary: MonthlySummary = {
    totalBreak: 0, totalInterrupt: 0, totalOvertime: 0,
    totalWork: 0, totalNightTime: 0, workDays: 0, paidLeaveDays: 0, offDays: 0,
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = monthStart.date(d);
    const dateStr = dateObj.format("YYYY-MM-DD");
    const dow = dateObj.day();
    const att = attMap.get(dateStr);
    const isLeave = leaveSet.has(dateStr);
    const isCorrected = corrSet.has(dateStr);

    let status: RecordStatus = "NOT_STARTED";
    if (isLeave) {
      status = "PAID_LEAVE";
      summary.paidLeaveDays++;
    } else if (att?.isFinalized && att.clockIn) {
      status = isCorrected ? "CORRECTED" : "FINISHED";
      summary.workDays++;
    } else if (att && att.status !== "NOT_STARTED") {
      status = "WORKING";
      summary.workDays++;
    } else {
      summary.offDays++;
    }

    // Break start/end from punch events (first pair)
    let breakStart: string | null = null;
    let breakEnd: string | null = null;
    if (att) {
      const bs = att.punchEvents.find((p) => p.type === "BREAK_START");
      const be = att.punchEvents.find((p) => p.type === "BREAK_END");
      if (bs) breakStart = formatClockTime(bs.timestamp);
      if (be) breakEnd = formatClockTime(be.timestamp);
    }

    const totalBreakSec = att?.totalBreak ?? 0;
    const totalInterruptSec = att?.totalInterrupt ?? 0;
    const overtimeSec = att?.overtimeRounded ?? 0;
    const totalWorkSec = att?.totalWork ?? 0;
    const nightTimeSec = att?.nightTime ?? 0;

    summary.totalBreak += totalBreakSec;
    summary.totalInterrupt += totalInterruptSec;
    summary.totalOvertime += overtimeSec;
    summary.totalWork += totalWorkSec;
    summary.totalNightTime += nightTimeSec;

    records.push({
      date: dateStr,
      day: d,
      dayOfWeek: DAYS[dow],
      dayOfWeekNum: dow,
      status,
      clockIn: att?.clockIn ? formatClockTime(att.clockIn) : null,
      clockOut: att?.clockOut ? formatClockTime(att.clockOut) : null,
      breakStart,
      breakEnd,
      totalBreak: formatHM(totalBreakSec),
      totalInterrupt: formatHM(totalInterruptSec),
      overtime: formatHM(overtimeSec),
      totalWork: formatHM(totalWorkSec),
      nightTime: formatHM(nightTimeSec),
      totalBreakSec,
      totalInterruptSec,
      overtimeSec,
      totalWorkSec,
      nightTimeSec,
    });
  }

  return { records, summary };
}

export async function getAvailableMonths(employeeId: string): Promise<{ year: number; month: number }[]> {
  const attendances = await prisma.dailyAttendance.findMany({
    where: { employeeId },
    select: { date: true },
    distinct: ["date"],
    orderBy: { date: "desc" },
  });

  const months = new Set<string>();
  for (const a of attendances) {
    const d = toJST(a.date);
    months.add(`${d.year()}-${d.month() + 1}`);
  }

  return [...months].map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return { year: y, month: mo };
  }).sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month));
}

export async function getEmployeeList() {
  return prisma.employee.findMany({
    where: { status: "active" },
    orderBy: { employeeNumber: "asc" },
    select: { id: true, employeeNumber: true, name: true },
  });
}

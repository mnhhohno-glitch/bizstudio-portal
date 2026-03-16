import { prisma } from "@/lib/prisma";
import type { Alert, AlertType } from "./types";
import { nowJST, toJST, dateForDB } from "./timezone";

/**
 * 当月分の未打刻アラートを検知して返す
 */
export async function getAlerts(employeeId: string): Promise<Alert[]> {
  // 打刻不要フラグチェック
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { isExemptFromAttendance: true } });
  if (emp?.isExemptFromAttendance) return [];

  const now = nowJST();
  const monthStart = now.startOf("month");
  const yesterday = now.subtract(1, "day").startOf("day");

  if (yesterday.isBefore(monthStart)) return [];

  const monthStartDB = dateForDB(monthStart);
  const yesterdayDB = dateForDB(yesterday);

  const attendances = await prisma.dailyAttendance.findMany({
    where: {
      employeeId,
      date: { gte: monthStartDB, lte: yesterdayDB },
    },
    include: { punchEvents: { orderBy: { timestamp: "asc" } } },
  });

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      targetDate: { gte: monthStartDB, lte: yesterdayDB },
      status: "APPROVED",
    },
  });
  const leaveSet = new Set(leaves.map((l) => toJST(l.targetDate).format("YYYY-MM-DD")));

  const attendanceMap = new Map(
    attendances.map((a) => [toJST(a.date).format("YYYY-MM-DD"), a])
  );

  const alerts: Alert[] = [];
  let cursor = monthStart;

  while (cursor.isBefore(yesterday) || cursor.isSame(yesterday, "day")) {
    const dateStr = cursor.format("YYYY-MM-DD");
    const dayOfWeek = cursor.day();

    if (dayOfWeek === 0 || dayOfWeek === 6) { cursor = cursor.add(1, "day"); continue; }
    if (leaveSet.has(dateStr)) { cursor = cursor.add(1, "day"); continue; }

    const attendance = attendanceMap.get(dateStr);
    const dayLabel = cursor.format("M月D日") + `（${["日", "月", "火", "水", "木", "金", "土"][dayOfWeek]}）`;

    if (!attendance || attendance.status === "NOT_STARTED") {
      alerts.push(makeAlert(dateStr, attendance?.id ?? "", "NO_CLOCK_IN", `${dayLabel}の出勤が未打刻です`));
    } else {
      const punches = attendance.punchEvents;

      if (attendance.clockIn && !attendance.clockOut && attendance.status !== "FINISHED") {
        alerts.push(makeAlert(dateStr, attendance.id, "NO_CLOCK_OUT", `${dayLabel}の退勤が未打刻です`));
      }

      const breakStarts = punches.filter((p) => p.type === "BREAK_START").length;
      const breakEnds = punches.filter((p) => p.type === "BREAK_END").length;
      if (breakStarts > breakEnds) {
        alerts.push(makeAlert(dateStr, attendance.id, "BREAK_NOT_ENDED", `${dayLabel}の休憩終了が未打刻です`));
      }

      const intStarts = punches.filter((p) => p.type === "INTERRUPT_START").length;
      const intEnds = punches.filter((p) => p.type === "INTERRUPT_END").length;
      if (intStarts > intEnds) {
        alerts.push(makeAlert(dateStr, attendance.id, "INTERRUPT_NOT_ENDED", `${dayLabel}の中断終了が未打刻です`));
      }

      if (attendance.isFinalized && attendance.totalBreak === 0 && attendance.totalWork > 21600) {
        alerts.push(makeAlert(dateStr, attendance.id, "NO_BREAK_OVER_6H", `${dayLabel}は6時間超勤務ですが休憩が未登録です`));
      }
    }

    cursor = cursor.add(1, "day");
  }

  return alerts;
}

function makeAlert(dateStr: string, dailyAttendanceId: string, type: AlertType, message: string): Alert {
  return { id: `${dateStr}-${type}`, date: new Date(dateStr + "T00:00:00.000Z"), type, message, dailyAttendanceId };
}

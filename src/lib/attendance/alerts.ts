import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { Alert, AlertType } from "./types";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 当月分の未打刻アラートを検知して返す
 */
export async function getAlerts(employeeId: string): Promise<Alert[]> {
  const now = dayjs().tz("Asia/Tokyo");
  const monthStart = now.startOf("month");
  const yesterday = now.subtract(1, "day").startOf("day");

  // 当日は対象外。月初が今日なら空
  if (yesterday.isBefore(monthStart)) return [];

  // 当月の勤怠レコードを一括取得
  const attendances = await prisma.dailyAttendance.findMany({
    where: {
      employeeId,
      date: { gte: monthStart.toDate(), lte: yesterday.toDate() },
    },
    include: { punchEvents: { orderBy: { timestamp: "asc" } } },
  });

  // 当月の承認済み休暇を取得
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      targetDate: { gte: monthStart.toDate(), lte: yesterday.toDate() },
      status: "APPROVED",
    },
  });
  const leaveSet = new Set(leaves.map((l) => dayjs(l.targetDate).format("YYYY-MM-DD")));

  const attendanceMap = new Map(
    attendances.map((a) => [dayjs(a.date).format("YYYY-MM-DD"), a])
  );

  const alerts: Alert[] = [];
  let cursor = monthStart;

  while (cursor.isBefore(yesterday) || cursor.isSame(yesterday, "day")) {
    const dateStr = cursor.format("YYYY-MM-DD");
    const dayOfWeek = cursor.day(); // 0=日, 6=土

    // 土日スキップ
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cursor = cursor.add(1, "day");
      continue;
    }

    // 承認済み休暇スキップ
    if (leaveSet.has(dateStr)) {
      cursor = cursor.add(1, "day");
      continue;
    }

    const attendance = attendanceMap.get(dateStr);
    const dayLabel = cursor.format("M月D日") + `（${["日", "月", "火", "水", "木", "金", "土"][dayOfWeek]}）`;

    if (!attendance || attendance.status === "NOT_STARTED") {
      // 出勤なし
      alerts.push(makeAlert(dateStr, attendance?.id ?? "", "NO_CLOCK_IN", `${dayLabel}の出勤が未打刻です`));
    } else {
      const punches = attendance.punchEvents;

      // 出勤あり・退勤なし
      if (attendance.clockIn && !attendance.clockOut && attendance.status !== "FINISHED") {
        alerts.push(makeAlert(dateStr, attendance.id, "NO_CLOCK_OUT", `${dayLabel}の退勤が未打刻です`));
      }

      // 休憩終了なし
      const breakStarts = punches.filter((p) => p.type === "BREAK_START").length;
      const breakEnds = punches.filter((p) => p.type === "BREAK_END").length;
      if (breakStarts > breakEnds) {
        alerts.push(makeAlert(dateStr, attendance.id, "BREAK_NOT_ENDED", `${dayLabel}の休憩終了が未打刻です`));
      }

      // 中断終了なし
      const intStarts = punches.filter((p) => p.type === "INTERRUPT_START").length;
      const intEnds = punches.filter((p) => p.type === "INTERRUPT_END").length;
      if (intStarts > intEnds) {
        alerts.push(makeAlert(dateStr, attendance.id, "INTERRUPT_NOT_ENDED", `${dayLabel}の中断終了が未打刻です`));
      }

      // 6h超勤務で休憩なし（確定済みのみ）
      if (attendance.isFinalized && attendance.totalBreak === 0 && attendance.totalWork > 21600) {
        alerts.push(makeAlert(dateStr, attendance.id, "NO_BREAK_OVER_6H", `${dayLabel}は6時間超勤務ですが休憩が未登録です`));
      }
    }

    cursor = cursor.add(1, "day");
  }

  return alerts;
}

function makeAlert(
  dateStr: string,
  dailyAttendanceId: string,
  type: AlertType,
  message: string
): Alert {
  return {
    id: `${dateStr}-${type}`,
    date: new Date(dateStr),
    type,
    message,
    dailyAttendanceId,
  };
}

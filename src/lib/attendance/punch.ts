"use server";

import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { PunchType } from "@prisma/client";
import { getAvailableActions, getNextStatus } from "./state";
import { validateClockOut } from "./validation";
import { calculateDailyTotals } from "./calculator";

dayjs.extend(utc);
dayjs.extend(timezone);

type PunchResult = {
  success: boolean;
  error?: string;
  validationErrors?: { code: string; message: string }[];
};

/**
 * 打刻実行
 */
export async function executePunch(
  employeeId: string,
  punchType: PunchType
): Promise<PunchResult> {
  const now = dayjs().tz("Asia/Tokyo");
  const todayDate = now.startOf("day").toDate();

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. 当日のDailyAttendanceを取得 or 作成
      let attendance = await tx.dailyAttendance.findUnique({
        where: { employeeId_date: { employeeId, date: todayDate } },
      });

      if (!attendance) {
        attendance = await tx.dailyAttendance.create({
          data: {
            employeeId,
            date: todayDate,
            status: "NOT_STARTED",
            updatedAt: now.toDate(),
          },
        });
      }

      // 2. ステート検証
      const allowed = getAvailableActions(attendance.status);
      if (!allowed.includes(punchType)) {
        return {
          success: false,
          error: `現在の状態（${attendance.status}）では${punchTypeLabel(punchType)}はできません`,
        };
      }

      // 3. 退勤時バリデーション
      if (punchType === "CLOCK_OUT") {
        const validation = await validateClockOut(attendance.id);
        if (!validation.canClockOut) {
          return {
            success: false,
            error: "退勤できません",
            validationErrors: validation.errors,
          };
        }
      }

      // 4. 遷移先ステート
      const nextStatus = getNextStatus(attendance.status, punchType);
      if (!nextStatus) {
        return { success: false, error: "不正なステート遷移です" };
      }

      // 5. PunchEvent作成
      await tx.punchEvent.create({
        data: {
          employeeId,
          dailyAttendanceId: attendance.id,
          type: punchType,
          timestamp: now.toDate(),
        },
      });

      // 6. DailyAttendance更新
      const updateData: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: now.toDate(),
      };

      if (punchType === "CLOCK_IN") {
        updateData.clockIn = now.toDate();
      }

      if (punchType === "CLOCK_OUT") {
        updateData.clockOut = now.toDate();
        updateData.isFinalized = true;
      }

      await tx.dailyAttendance.update({
        where: { id: attendance.id },
        data: updateData,
      });

      // 7. 退勤時は集計計算
      if (punchType === "CLOCK_OUT") {
        const totals = await calculateDailyTotals(attendance.id);
        await tx.dailyAttendance.update({
          where: { id: attendance.id },
          data: {
            totalBreak: totals.totalBreak,
            totalInterrupt: totals.totalInterrupt,
            totalWork: totals.totalWork,
            overtime: totals.overtime,
            overtimeRounded: totals.overtimeRounded,
            nightTime: totals.nightTime,
            note: totals.note,
          },
        });
      }

      return { success: true };
    });
  } catch (e) {
    console.error("打刻エラー:", e);
    return { success: false, error: "打刻処理に失敗しました" };
  }
}

/**
 * 確定前の打刻を申請なしで修正する
 */
export async function editPunchBeforeFinalize(
  punchEventId: string,
  newTimestamp: Date
): Promise<PunchResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const punch = await tx.punchEvent.findUnique({
        where: { id: punchEventId },
        include: { dailyAttendance: true },
      });

      if (!punch) {
        return { success: false, error: "打刻データが見つかりません" };
      }

      if (punch.dailyAttendance.isFinalized) {
        return { success: false, error: "確定済みの勤怠は修正申請が必要です" };
      }

      await tx.punchEvent.update({
        where: { id: punchEventId },
        data: { timestamp: newTimestamp, isManualEdit: true },
      });

      // CLOCK_IN / CLOCK_OUT の場合はDailyAttendanceも更新
      if (punch.type === "CLOCK_IN") {
        await tx.dailyAttendance.update({
          where: { id: punch.dailyAttendanceId },
          data: { clockIn: newTimestamp },
        });
      } else if (punch.type === "CLOCK_OUT") {
        await tx.dailyAttendance.update({
          where: { id: punch.dailyAttendanceId },
          data: { clockOut: newTimestamp },
        });
      }

      return { success: true };
    });
  } catch (e) {
    console.error("打刻修正エラー:", e);
    return { success: false, error: "打刻修正に失敗しました" };
  }
}

function punchTypeLabel(type: PunchType): string {
  const labels: Record<PunchType, string> = {
    CLOCK_IN: "出勤",
    BREAK_START: "休憩開始",
    BREAK_END: "休憩終了",
    INTERRUPT_START: "中断開始",
    INTERRUPT_END: "中断終了",
    CLOCK_OUT: "退勤",
  };
  return labels[type] ?? type;
}

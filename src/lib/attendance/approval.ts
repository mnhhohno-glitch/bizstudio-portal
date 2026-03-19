import { prisma } from "@/lib/prisma";
import { calculateDailyTotals } from "./calculator";
import type { PunchType } from "@prisma/client";

const PUNCH_TYPE_MAP: Record<string, PunchType> = {
  CLOCK_IN_EDIT: "CLOCK_IN",
  CLOCK_OUT_EDIT: "CLOCK_OUT",
  BREAK_START_EDIT: "BREAK_START",
  BREAK_END_EDIT: "BREAK_END",
  INTERRUPT_START_EDIT: "INTERRUPT_START",
  INTERRUPT_END_EDIT: "INTERRUPT_END",
  ADD_BREAK: "BREAK_START", // 追加の場合はSTARTとENDを別々に
  ADD_INTERRUPT: "INTERRUPT_START",
};

/**
 * 打刻修正申請を承認（複数項目対応）
 */
export async function approveModificationRequest(
  token: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const req = await tx.modificationRequest.findUnique({
        where: { approvalToken: token },
        include: { employee: true, items: true },
      });

      if (!req) return { success: false, error: "申請が見つかりません" };
      if (req.status !== "PENDING") return { success: false, error: "この申請は既に処理されています" };

      // 承認ステータス更新
      await tx.modificationRequest.update({
        where: { id: req.id },
        data: { status: "APPROVED", approvedBy: adminId, updatedAt: new Date() },
      });

      // 対象日のDailyAttendanceを取得
      const attendance = await tx.dailyAttendance.findUnique({
        where: { employeeId_date: { employeeId: req.employeeId, date: req.targetDate } },
      });
      if (!attendance) return { success: true }; // データなし→承認だけ

      // 修正項目を取得（新スキーマのitemsがあればそちらを使う、なければ旧カラム）
      const items = req.items.length > 0
        ? req.items
        : req.requestType && req.afterValue
          ? [{ requestType: req.requestType, beforeValue: req.beforeValue, afterValue: req.afterValue }]
          : [];

      // 各項目を適用
      for (const item of items) {
        const punchType = PUNCH_TYPE_MAP[item.requestType];
        if (!punchType) continue;

        if (item.beforeValue) {
          // 既存打刻の修正
          const punch = await tx.punchEvent.findFirst({
            where: { dailyAttendanceId: attendance.id, type: punchType },
            orderBy: { timestamp: "asc" },
          });
          if (punch) {
            await tx.punchEvent.update({
              where: { id: punch.id },
              data: { timestamp: item.afterValue, isManualEdit: true },
            });
          }
        } else {
          // 新規打刻の追加
          await tx.punchEvent.create({
            data: {
              employeeId: req.employeeId,
              dailyAttendanceId: attendance.id,
              type: punchType,
              timestamp: item.afterValue,
              isManualEdit: true,
            },
          });
        }

        // CLOCK_IN/CLOCK_OUT変更時はDailyAttendanceも更新
        if (punchType === "CLOCK_IN") {
          await tx.dailyAttendance.update({ where: { id: attendance.id }, data: { clockIn: item.afterValue } });
        } else if (punchType === "CLOCK_OUT") {
          await tx.dailyAttendance.update({ where: { id: attendance.id }, data: { clockOut: item.afterValue } });
        }
      }

      // status と clockIn/clockOut を PunchEvent から再計算し、集計値も再計算
      if (items.length > 0) {
        const allEvents = await tx.punchEvent.findMany({
          where: { dailyAttendanceId: attendance.id },
          orderBy: { timestamp: "asc" },
        });

        const clockInEvent = allEvents.find((e) => e.type === "CLOCK_IN");
        const clockOutEvent = allEvents.find((e) => e.type === "CLOCK_OUT");

        let newStatus: "NOT_STARTED" | "WORKING" | "ON_BREAK" | "INTERRUPTED" | "FINISHED";
        if (!clockInEvent) {
          newStatus = "NOT_STARTED";
        } else if (clockOutEvent) {
          newStatus = "FINISHED";
        } else {
          const lastEvent = allEvents[allEvents.length - 1];
          if (lastEvent.type === "BREAK_START") {
            newStatus = "ON_BREAK";
          } else if (lastEvent.type === "INTERRUPT_START") {
            newStatus = "INTERRUPTED";
          } else {
            newStatus = "WORKING";
          }
        }

        const totals = await calculateDailyTotals(attendance.id, tx);
        await tx.dailyAttendance.update({
          where: { id: attendance.id },
          data: {
            status: newStatus,
            clockIn: clockInEvent?.timestamp ?? null,
            clockOut: clockOutEvent?.timestamp ?? null,
            isFinalized: newStatus === "FINISHED",
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
    console.error("承認エラー:", e);
    return { success: false, error: "承認処理に失敗しました" };
  }
}

/**
 * 有給申請を承認
 */
export async function approveLeaveRequest(
  token: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.findUnique({
        where: { approvalToken: token },
        include: { employee: true },
      });

      if (!req) return { success: false, error: "申請が見つかりません" };
      if (req.status !== "PENDING") return { success: false, error: "この申請は既に処理されています" };

      const deduction = req.leaveType === "PAID_HALF" ? 0.5 : req.leaveType === "PAID_FULL" ? 1 : 0;
      if (deduction > 0 && req.employee.paidLeave < deduction) {
        return { success: false, error: "有給残日数が不足しています" };
      }

      await tx.leaveRequest.update({
        where: { id: req.id },
        data: { status: "APPROVED", approvedBy: adminId, updatedAt: new Date() },
      });

      if (deduction > 0) {
        await tx.employee.update({
          where: { id: req.employeeId },
          data: { paidLeave: { decrement: deduction } },
        });
      }

      const noteText = req.leaveType === "PAID_HALF"
        ? `有給(半日${req.halfDay ?? ""})`
        : req.leaveType === "PAID_FULL" ? "有給" : "休暇";

      await tx.dailyAttendance.upsert({
        where: { employeeId_date: { employeeId: req.employeeId, date: req.targetDate } },
        update: { note: noteText, status: "FINISHED", isFinalized: true },
        create: {
          employeeId: req.employeeId,
          date: req.targetDate,
          status: "FINISHED",
          isFinalized: true,
          note: noteText,
          updatedAt: new Date(),
        },
      });

      return { success: true };
    });
  } catch (e) {
    console.error("有給承認エラー:", e);
    return { success: false, error: "承認処理に失敗しました" };
  }
}

/**
 * 申請を差し戻し
 */
export async function rejectRequest(
  token: string,
  adminId: string,
  rejectionReason: string,
  type: "modification" | "leave"
): Promise<{ success: boolean; error?: string }> {
  try {
    if (type === "modification") {
      const req = await prisma.modificationRequest.findUnique({ where: { approvalToken: token } });
      if (!req || req.status !== "PENDING") return { success: false, error: "申請が見つからないか処理済みです" };
      await prisma.modificationRequest.update({
        where: { id: req.id },
        data: { status: "REJECTED", approvedBy: adminId, rejectionReason, updatedAt: new Date() },
      });
    } else {
      const req = await prisma.leaveRequest.findUnique({ where: { approvalToken: token } });
      if (!req || req.status !== "PENDING") return { success: false, error: "申請が見つからないか処理済みです" };
      await prisma.leaveRequest.update({
        where: { id: req.id },
        data: { status: "REJECTED", approvedBy: adminId, rejectionReason, updatedAt: new Date() },
      });
    }
    return { success: true };
  } catch (e) {
    console.error("差し戻しエラー:", e);
    return { success: false, error: "差し戻し処理に失敗しました" };
  }
}

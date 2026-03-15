import { prisma } from "@/lib/prisma";
import { calculateDailyTotals } from "./calculator";

/**
 * 打刻修正申請を承認
 */
export async function approveModificationRequest(
  token: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const req = await tx.modificationRequest.findUnique({
        where: { approvalToken: token },
        include: { employee: true },
      });

      if (!req) return { success: false, error: "申請が見つかりません" };
      if (req.status !== "PENDING") return { success: false, error: "この申請は既に処理されています" };

      // 申請を承認
      await tx.modificationRequest.update({
        where: { id: req.id },
        data: { status: "APPROVED", approvedBy: adminId, updatedAt: new Date() },
      });

      // 対応するPunchEventを修正（ADD_*以外の編集系）
      if (req.afterValue && !req.requestType.startsWith("ADD_")) {
        const punchTypeMap: Record<string, string> = {
          CLOCK_IN_EDIT: "CLOCK_IN",
          CLOCK_OUT_EDIT: "CLOCK_OUT",
          BREAK_START_EDIT: "BREAK_START",
          BREAK_END_EDIT: "BREAK_END",
          INTERRUPT_START_EDIT: "INTERRUPT_START",
          INTERRUPT_END_EDIT: "INTERRUPT_END",
        };
        const punchType = punchTypeMap[req.requestType];
        if (punchType) {
          const attendance = await tx.dailyAttendance.findUnique({
            where: { employeeId_date: { employeeId: req.employeeId, date: req.targetDate } },
          });
          if (attendance) {
            // 該当タイプの打刻を更新
            const punch = await tx.punchEvent.findFirst({
              where: { dailyAttendanceId: attendance.id, type: punchType as never },
              orderBy: { timestamp: "asc" },
            });
            if (punch) {
              await tx.punchEvent.update({
                where: { id: punch.id },
                data: { timestamp: req.afterValue, isManualEdit: true },
              });
            }

            // CLOCK_IN/CLOCK_OUT変更時はDailyAttendanceも更新
            if (punchType === "CLOCK_IN") {
              await tx.dailyAttendance.update({ where: { id: attendance.id }, data: { clockIn: req.afterValue } });
            } else if (punchType === "CLOCK_OUT") {
              await tx.dailyAttendance.update({ where: { id: attendance.id }, data: { clockOut: req.afterValue } });
            }

            // 集計値を再計算
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
        }
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

      // 有給の場合、残日数チェック＆減算
      const deduction = req.leaveType === "PAID_HALF" ? 0.5 : req.leaveType === "PAID_FULL" ? 1 : 0;
      if (deduction > 0 && req.employee.paidLeave < deduction) {
        return { success: false, error: "有給残日数が不足しています" };
      }

      // 申請を承認
      await tx.leaveRequest.update({
        where: { id: req.id },
        data: { status: "APPROVED", approvedBy: adminId, updatedAt: new Date() },
      });

      // 有給残日数を減算
      if (deduction > 0) {
        await tx.employee.update({
          where: { id: req.employeeId },
          data: { paidLeave: { decrement: deduction } },
        });
      }

      // DailyAttendanceにnoteを設定
      const noteText = req.leaveType === "PAID_HALF"
        ? `有給(半日${req.halfDay ?? ""})`
        : req.leaveType === "PAID_FULL"
          ? "有給"
          : "休暇";

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
 * 申請を差し戻し（打刻修正・有給共通）
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

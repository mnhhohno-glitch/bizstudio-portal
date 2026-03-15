import { prisma } from "@/lib/prisma";
import { getLineClient } from "./client";
import { buildModificationRequestMessage, buildLeaveRequestMessage, buildApprovalResultMessage } from "./templates";
import { toJST } from "@/lib/attendance/timezone";

const MOD_TYPE_LABEL: Record<string, string> = {
  CLOCK_IN_EDIT: "出勤時刻修正", CLOCK_OUT_EDIT: "退勤時刻修正",
  BREAK_START_EDIT: "休憩開始修正", BREAK_END_EDIT: "休憩終了修正",
  INTERRUPT_START_EDIT: "中断開始修正", INTERRUPT_END_EDIT: "中断終了修正",
  ADD_BREAK: "休憩追加", ADD_INTERRUPT: "中断追加",
};
const LEAVE_LABEL: Record<string, string> = { PAID_FULL: "有給（全日）", PAID_HALF: "有給（半日）", OTHER: "その他休暇" };

function formatDate(d: Date): string {
  const dt = toJST(d);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${dt.month() + 1}月${dt.date()}日（${days[dt.day()]}）`;
}

function formatTime(d: Date | null): string {
  if (!d) return "-";
  return toJST(d).format("HH:mm:ss");
}

/**
 * 管理者に打刻修正申請を通知
 */
export async function notifyAdminModificationRequest(requestId: string): Promise<void> {
  const client = getLineClient();
  if (!client) return;

  try {
    const req = await prisma.modificationRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) return;

    // 管理者のlineUserIdを取得（User.role === "admin"に紐づくEmployee）
    const admins = await prisma.employee.findMany({
      where: { lineUserId: { not: null }, user: { role: "admin" } },
      select: { lineUserId: true },
    });

    if (admins.length === 0) {
      console.warn("LINE通知先の管理者がいません");
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.PORTAL_BASE_URL ?? "";
    const approvalUrl = `${baseUrl}/attendance/approve/${req.approvalToken}`;

    const message = buildModificationRequestMessage({
      employeeName: req.employee.name,
      targetDate: formatDate(req.targetDate),
      modType: req.requestType,
      beforeValue: formatTime(req.beforeValue),
      afterValue: formatTime(req.afterValue),
      reason: req.reason,
      approvalUrl,
    });

    for (const admin of admins) {
      if (!admin.lineUserId) continue;
      try {
        await client.pushMessage({ to: admin.lineUserId, messages: [message] });
      } catch (e) {
        console.error(`LINE通知失敗 (${admin.lineUserId}):`, e);
      }
    }
  } catch (e) {
    console.error("打刻修正通知エラー:", e);
  }
}

/**
 * 管理者に有給申請を通知
 */
export async function notifyAdminLeaveRequest(requestId: string): Promise<void> {
  const client = getLineClient();
  if (!client) return;

  try {
    const req = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) return;

    const admins = await prisma.employee.findMany({
      where: { lineUserId: { not: null }, user: { role: "admin" } },
      select: { lineUserId: true },
    });

    if (admins.length === 0) return;

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.PORTAL_BASE_URL ?? "";
    const approvalUrl = `${baseUrl}/attendance/approve/${req.approvalToken}`;

    const message = buildLeaveRequestMessage({
      employeeName: req.employee.name,
      targetDate: formatDate(req.targetDate),
      leaveType: req.leaveType,
      remainingDays: req.employee.paidLeave,
      reason: req.reason,
      approvalUrl,
    });

    for (const admin of admins) {
      if (!admin.lineUserId) continue;
      try {
        await client.pushMessage({ to: admin.lineUserId, messages: [message] });
      } catch (e) {
        console.error(`LINE通知失敗 (${admin.lineUserId}):`, e);
      }
    }
  } catch (e) {
    console.error("有給申請通知エラー:", e);
  }
}

/**
 * 従業員に承認結果を通知
 */
export async function notifyEmployeeApprovalResult(
  requestType: "modification" | "leave",
  requestId: string,
  approved: boolean,
  rejectionReason?: string
): Promise<void> {
  const client = getLineClient();
  if (!client) return;

  try {
    let lineUserId: string | null = null;
    let targetDate: Date;
    let detail: string;

    if (requestType === "modification") {
      const req = await prisma.modificationRequest.findUnique({
        where: { id: requestId },
        include: { employee: true },
      });
      if (!req || !req.employee.lineUserId) return;
      lineUserId = req.employee.lineUserId;
      targetDate = req.targetDate;
      detail = MOD_TYPE_LABEL[req.requestType] ?? req.requestType;
    } else {
      const req = await prisma.leaveRequest.findUnique({
        where: { id: requestId },
        include: { employee: true },
      });
      if (!req || !req.employee.lineUserId) return;
      lineUserId = req.employee.lineUserId;
      targetDate = req.targetDate;
      detail = LEAVE_LABEL[req.leaveType] ?? req.leaveType;
    }

    const message = buildApprovalResultMessage({
      type: requestType,
      targetDate: formatDate(targetDate),
      detail,
      approved,
      rejectionReason,
    });

    try {
      await client.pushMessage({ to: lineUserId, messages: [message] });
    } catch (e) {
      console.error(`LINE通知失敗 (${lineUserId}):`, e);
    }
  } catch (e) {
    console.error("承認結果通知エラー:", e);
  }
}

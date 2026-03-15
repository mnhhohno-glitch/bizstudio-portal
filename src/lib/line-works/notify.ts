import { prisma } from "@/lib/prisma";
import { sendMessageToUser } from "./client";
import {
  buildModificationRequestMessage,
  buildLeaveRequestMessage,
  buildApprovalResultMessage,
  getModTypeLabel,
  getLeaveTypeLabel,
} from "./templates";
import { toJST } from "@/lib/attendance/timezone";

function formatDate(d: Date): string {
  const dt = toJST(d);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${dt.month() + 1}月${dt.date()}日（${days[dt.day()]}）`;
}

function formatTime(d: Date | null): string {
  if (!d) return "-";
  return toJST(d).format("HH:mm:ss");
}

/** 管理者に打刻修正申請を通知 */
export async function notifyAdminModificationRequest(requestId: string): Promise<void> {
  try {
    const req = await prisma.modificationRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) return;

    const admins = await prisma.employee.findMany({
      where: { lineUserId: { not: null }, user: { role: "admin" } },
      select: { lineUserId: true, name: true },
    });
    if (admins.length === 0) { console.warn("LINE WORKS通知先の管理者がいません"); return; }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.PORTAL_BASE_URL ?? "";
    const message = buildModificationRequestMessage({
      employeeName: req.employee.name,
      targetDate: formatDate(req.targetDate),
      modType: getModTypeLabel(req.requestType),
      beforeValue: formatTime(req.beforeValue),
      afterValue: formatTime(req.afterValue),
      reason: req.reason,
      approvalUrl: `${baseUrl}/attendance/approve/${req.approvalToken}`,
    });

    for (const admin of admins) {
      if (!admin.lineUserId) continue;
      try { await sendMessageToUser(admin.lineUserId, message); }
      catch (e) { console.error(`LINE WORKS通知失敗 (${admin.name}):`, e); }
    }
  } catch (e) {
    console.error("打刻修正通知エラー:", e);
  }
}

/** 管理者に有給申請を通知 */
export async function notifyAdminLeaveRequest(requestId: string): Promise<void> {
  try {
    const req = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) return;

    const admins = await prisma.employee.findMany({
      where: { lineUserId: { not: null }, user: { role: "admin" } },
      select: { lineUserId: true, name: true },
    });
    if (admins.length === 0) return;

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.PORTAL_BASE_URL ?? "";
    const message = buildLeaveRequestMessage({
      employeeName: req.employee.name,
      targetDate: formatDate(req.targetDate),
      leaveType: getLeaveTypeLabel(req.leaveType),
      remainingDays: req.employee.paidLeave,
      reason: req.reason,
      approvalUrl: `${baseUrl}/attendance/approve/${req.approvalToken}`,
    });

    for (const admin of admins) {
      if (!admin.lineUserId) continue;
      try { await sendMessageToUser(admin.lineUserId, message); }
      catch (e) { console.error(`LINE WORKS通知失敗 (${admin.name}):`, e); }
    }
  } catch (e) {
    console.error("有給申請通知エラー:", e);
  }
}

/** 従業員に承認結果を通知 */
export async function notifyEmployeeApprovalResult(
  requestType: "modification" | "leave",
  requestId: string,
  approved: boolean,
  rejectionReason?: string
): Promise<void> {
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
      detail = getModTypeLabel(req.requestType);
    } else {
      const req = await prisma.leaveRequest.findUnique({
        where: { id: requestId },
        include: { employee: true },
      });
      if (!req || !req.employee.lineUserId) return;
      lineUserId = req.employee.lineUserId;
      targetDate = req.targetDate;
      detail = getLeaveTypeLabel(req.leaveType);
    }

    const message = buildApprovalResultMessage({
      type: requestType,
      targetDate: formatDate(targetDate),
      detail,
      approved,
      rejectionReason,
    });

    try { await sendMessageToUser(lineUserId, message); }
    catch (e) { console.error(`LINE WORKS通知失敗 (${lineUserId}):`, e); }
  } catch (e) {
    console.error("承認結果通知エラー:", e);
  }
}

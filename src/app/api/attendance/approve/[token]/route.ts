import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { approveModificationRequest, approveLeaveRequest, rejectRequest } from "@/lib/attendance/approval";
import { notifyEmployeeApprovalResult } from "@/lib/line/notify";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Try modification request first, then leave request
  const modReq = await prisma.modificationRequest.findUnique({
    where: { approvalToken: token },
    include: { employee: true },
  });
  if (modReq) {
    return NextResponse.json({
      type: "modification",
      id: modReq.id,
      status: modReq.status,
      employee: { name: modReq.employee.name },
      targetDate: modReq.targetDate,
      requestType: modReq.requestType,
      beforeValue: modReq.beforeValue,
      afterValue: modReq.afterValue,
      reason: modReq.reason,
      rejectionReason: modReq.rejectionReason,
    });
  }

  const leaveReq = await prisma.leaveRequest.findUnique({
    where: { approvalToken: token },
    include: { employee: true },
  });
  if (leaveReq) {
    return NextResponse.json({
      type: "leave",
      id: leaveReq.id,
      status: leaveReq.status,
      employee: { name: leaveReq.employee.name, paidLeave: leaveReq.employee.paidLeave },
      targetDate: leaveReq.targetDate,
      leaveType: leaveReq.leaveType,
      halfDay: leaveReq.halfDay,
      reason: leaveReq.reason,
      rejectionReason: leaveReq.rejectionReason,
    });
  }

  return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const { token } = await params;
  const body = await request.json();
  const { action, rejectionReason } = body; // action: "approve" | "reject"

  // Determine type
  const modReq = await prisma.modificationRequest.findUnique({ where: { approvalToken: token } });
  const leaveReq = modReq ? null : await prisma.leaveRequest.findUnique({ where: { approvalToken: token } });
  const type = modReq ? "modification" : leaveReq ? "leave" : null;

  if (!type) {
    return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
  }

  if (action === "reject") {
    if (!rejectionReason?.trim()) {
      return NextResponse.json({ error: "差し戻し理由を入力してください" }, { status: 400 });
    }
    const result = await rejectRequest(token, user.id, rejectionReason.trim(), type);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    const reqId = modReq?.id ?? leaveReq?.id ?? "";
    notifyEmployeeApprovalResult(type, reqId, false, rejectionReason.trim()).catch((e) => console.error("LINE通知エラー:", e));
    return NextResponse.json({ success: true });
  }

  // Approve
  const result = type === "modification"
    ? await approveModificationRequest(token, user.id)
    : await approveLeaveRequest(token, user.id);

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  const reqId = modReq?.id ?? leaveReq?.id ?? "";
  notifyEmployeeApprovalResult(type, reqId, true).catch((e) => console.error("LINE通知エラー:", e));
  return NextResponse.json({ success: true });
}

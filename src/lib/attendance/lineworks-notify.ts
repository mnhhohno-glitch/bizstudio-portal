import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";
import { toJST } from "./timezone";
import type { PunchType } from "@prisma/client";

const BOT_ID = () => process.env.LINEWORKS_ATTENDANCE_BOT_ID ?? "";
const CHANNEL_ID = () => process.env.LINEWORKS_ATTENDANCE_CHANNEL_ID ?? "";

async function sendToChannel(text: string): Promise<void> {
  const botId = BOT_ID();
  const channelId = CHANNEL_ID();
  if (!botId || !channelId) {
    console.warn("勤怠通知: Bot/Channel ID未設定");
    return;
  }

  // メンション付き送信を試み、失敗したらメンションなしで再送
  try {
    await sendBotMessage(botId, channelId, text);
  } catch (e) {
    console.warn("メンション付き通知失敗、メンションなしで再送:", e);
    const plainText = text.replace(/<m userId="[^"]*">/g, "");
    try {
      await sendBotMessage(botId, channelId, plainText);
    } catch (e2) {
      console.error("勤怠通知送信失敗:", e2);
    }
  }
}

function formatEstimatedTime(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

const PUNCH_MESSAGES: Record<string, string> = {
  CLOCK_IN: "おはようございます！業務開始いたします！本日もよろしくお願いします！",
  CLOCK_OUT: "本日の業務を終了いたします！お疲れ様でした！",
  BREAK_START: "これから休憩に入ります！",
  BREAK_END: "休憩終了しました。業務戻ります！",
  INTERRUPT_END: "中断終了いたしました。業務に戻ります！",
};

const MOD_LABEL: Record<string, string> = {
  CLOCK_IN_EDIT: "出勤時刻", CLOCK_OUT_EDIT: "退勤時刻",
  BREAK_START_EDIT: "休憩開始", BREAK_END_EDIT: "休憩終了",
  INTERRUPT_START_EDIT: "中断開始", INTERRUPT_END_EDIT: "中断終了",
  ADD_BREAK: "休憩追加", ADD_INTERRUPT: "中断追加",
};

const LEAVE_LABEL: Record<string, string> = {
  PAID_FULL: "有給（全日）", PAID_HALF: "有給（半日）", OTHER: "その他休暇",
};

/**
 * 打刻アクションの通知
 */
export async function notifyPunchAction(
  employeeId: string,
  punchType: PunchType,
  timestamp: Date,
  estimatedMinutes?: number | null
): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { lineworksId: true } } },
  });
  if (!employee) return;

  const mention = employee.user?.lineworksId
    ? `<m userId="${employee.user.lineworksId}">`
    : "";
  const name = employee.name;
  const time = toJST(timestamp).format("H:mm");

  let messageBody: string;
  if (punchType === "INTERRUPT_START") {
    messageBody = estimatedMinutes
      ? `${formatEstimatedTime(estimatedMinutes)}程度中断いたします！`
      : "時間未定ですが一時中断いたします！";
  } else {
    messageBody = PUNCH_MESSAGES[punchType] ?? `${punchType}を打刻しました`;
  }

  const text = [
    `${mention}${name}`,
    messageBody,
    `⏰ ${time}`,
  ].join("\n");

  await sendToChannel(text);
}

/**
 * 打刻修正申請の通知（管理者へ）
 */
export async function notifyAdminModificationRequest(requestId: string): Promise<void> {
  const req = await prisma.modificationRequest.findUnique({
    where: { id: requestId },
    include: { employee: true },
  });
  if (!req) return;

  // 管理者のlineworksIdを取得
  const admins = await prisma.user.findMany({
    where: { role: "admin", status: "active", lineworksId: { not: null } },
    select: { lineworksId: true },
  });
  const adminMention = admins[0]?.lineworksId
    ? `<m userId="${admins[0].lineworksId}">`
    : "";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.PORTAL_BASE_URL ?? "";
  const approvalUrl = `${baseUrl}/attendance/approve/${req.approvalToken}`;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const dt = toJST(req.targetDate);

  const text = [
    "📋 打刻修正申請",
    "",
    `${adminMention} 修正申請が届きました`,
    "",
    `■ 申請者: ${req.employee.name}`,
    `■ 対象日: ${dt.month() + 1}月${dt.date()}日（${days[dt.day()]}）`,
    `■ 種別: ${MOD_LABEL[req.requestType] ?? req.requestType}`,
    `■ 修正前: ${req.beforeValue ? toJST(req.beforeValue).format("H:mm") : "-"}`,
    `■ 修正後: ${req.afterValue ? toJST(req.afterValue).format("H:mm") : "-"}`,
    `■ 理由: ${req.reason}`,
    "",
    `▶ 確認・承認: ${approvalUrl}`,
  ].join("\n");

  await sendToChannel(text);
}

/**
 * 有給申請の通知（管理者へ）
 */
export async function notifyAdminLeaveRequest(requestId: string): Promise<void> {
  const req = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: true },
  });
  if (!req) return;

  const admins = await prisma.user.findMany({
    where: { role: "admin", status: "active", lineworksId: { not: null } },
    select: { lineworksId: true },
  });
  const adminMention = admins[0]?.lineworksId
    ? `<m userId="${admins[0].lineworksId}">`
    : "";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.PORTAL_BASE_URL ?? "";
  const approvalUrl = `${baseUrl}/attendance/approve/${req.approvalToken}`;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const dt = toJST(req.targetDate);

  const lines = [
    "📋 有給申請",
    "",
    `${adminMention} 有給申請が届きました`,
    "",
    `■ 申請者: ${req.employee.name}`,
    `■ 対象日: ${dt.month() + 1}月${dt.date()}日（${days[dt.day()]}）`,
    `■ 種別: ${LEAVE_LABEL[req.leaveType] ?? req.leaveType}`,
    `■ 残日数: ${req.employee.paidLeave}日`,
  ];
  if (req.reason) lines.push(`■ 理由: ${req.reason}`);
  lines.push("", `▶ 確認・承認: ${approvalUrl}`);

  await sendToChannel(lines.join("\n"));
}

/**
 * 承認結果の通知（チャンネル全体、メンションなし）
 */
export async function notifyApprovalResult(
  requestType: "modification" | "leave",
  requestId: string,
  approved: boolean,
  rejectionReason?: string
): Promise<void> {
  let targetDate: Date;
  let employeeName: string;

  if (requestType === "modification") {
    const req = await prisma.modificationRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) return;
    targetDate = req.targetDate;
    employeeName = req.employee.name;
  } else {
    const req = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) return;
    targetDate = req.targetDate;
    employeeName = req.employee.name;
  }

  const typeLabel = requestType === "modification" ? "打刻修正" : "有給申請";
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const dt = toJST(targetDate);
  const dateStr = `${dt.month() + 1}月${dt.date()}日（${days[dt.day()]}）`;

  let text: string;
  if (approved) {
    text = `✅ ${dateStr}の${typeLabel}が承認されました（${employeeName}）`;
  } else {
    text = [
      `❌ ${dateStr}の${typeLabel}が差し戻されました（${employeeName}）`,
      `理由: ${rejectionReason || "(理由なし)"}`,
    ].join("\n");
  }

  await sendToChannel(text);
}

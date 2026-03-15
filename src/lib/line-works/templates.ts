import type { MessageContent } from "./client";

const MOD_TYPE_LABEL: Record<string, string> = {
  CLOCK_IN_EDIT: "出勤時刻", CLOCK_OUT_EDIT: "退勤時刻",
  BREAK_START_EDIT: "休憩開始", BREAK_END_EDIT: "休憩終了",
  INTERRUPT_START_EDIT: "中断開始", INTERRUPT_END_EDIT: "中断終了",
  ADD_BREAK: "休憩追加", ADD_INTERRUPT: "中断追加",
};

const LEAVE_TYPE_LABEL: Record<string, string> = {
  PAID_FULL: "有給（全日）", PAID_HALF: "有給（半日）", OTHER: "その他休暇",
};

export function getModTypeLabel(type: string): string {
  return MOD_TYPE_LABEL[type] ?? type;
}

export function getLeaveTypeLabel(type: string): string {
  return LEAVE_TYPE_LABEL[type] ?? type;
}

/** 打刻修正申請通知（管理者向け） */
export function buildModificationRequestMessage(params: {
  employeeName: string;
  targetDate: string;
  modType: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
  approvalUrl: string;
}): MessageContent {
  return {
    type: "button_template",
    contentText: [
      "📋 打刻修正申請",
      "",
      `申請者: ${params.employeeName}`,
      `対象日: ${params.targetDate}`,
      `種別: ${params.modType}`,
      `修正前: ${params.beforeValue}`,
      `修正後: ${params.afterValue}`,
      `理由: ${params.reason}`,
    ].join("\n"),
    actions: [{ type: "uri", label: "確認・承認する", uri: params.approvalUrl }],
  };
}

/** 有給申請通知（管理者向け） */
export function buildLeaveRequestMessage(params: {
  employeeName: string;
  targetDate: string;
  leaveType: string;
  remainingDays: number;
  reason: string | null;
  approvalUrl: string;
}): MessageContent {
  return {
    type: "button_template",
    contentText: [
      "📋 休暇申請",
      "",
      `申請者: ${params.employeeName}`,
      `対象日: ${params.targetDate}`,
      `種別: ${params.leaveType}`,
      `残日数: ${params.remainingDays}日`,
      params.reason ? `理由: ${params.reason}` : "",
    ].filter(Boolean).join("\n"),
    actions: [{ type: "uri", label: "確認・承認する", uri: params.approvalUrl }],
  };
}

/** 承認結果通知（従業員向け） */
export function buildApprovalResultMessage(params: {
  type: "modification" | "leave";
  targetDate: string;
  detail: string;
  approved: boolean;
  rejectionReason?: string;
}): MessageContent {
  if (params.approved) {
    return {
      type: "text",
      text: `✅ ${params.targetDate}の${params.detail}が承認されました`,
    };
  }
  return {
    type: "text",
    text: [
      `❌ ${params.targetDate}の${params.detail}が差し戻されました`,
      "",
      `理由: ${params.rejectionReason || "(理由なし)"}`,
    ].join("\n"),
  };
}

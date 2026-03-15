// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexMessage = any;

const MOD_TYPE_LABEL: Record<string, string> = {
  CLOCK_IN_EDIT: "出勤時刻", CLOCK_OUT_EDIT: "退勤時刻",
  BREAK_START_EDIT: "休憩開始", BREAK_END_EDIT: "休憩終了",
  INTERRUPT_START_EDIT: "中断開始", INTERRUPT_END_EDIT: "中断終了",
  ADD_BREAK: "休憩追加", ADD_INTERRUPT: "中断追加",
};

const LEAVE_TYPE_LABEL: Record<string, string> = {
  PAID_FULL: "有給（全日）", PAID_HALF: "有給（半日）", OTHER: "その他休暇",
};

function infoRow(label: string, value: string): object {
  return {
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#888888", size: "sm", flex: 0, wrap: true },
      { type: "text", text: value, size: "sm", wrap: true },
    ],
  };
}

/**
 * 打刻修正申請通知（管理者向け）
 */
export function buildModificationRequestMessage(params: {
  employeeName: string;
  targetDate: string;
  modType: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
  approvalUrl: string;
}): FlexMessage {
  const bubble = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical",
      backgroundColor: "#2563EB",
      paddingAll: "15px",
      contents: [
        { type: "text", text: "🔔 打刻修正申請", color: "#FFFFFF", weight: "bold", size: "md" },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        infoRow("申請者", params.employeeName),
        infoRow("対象日", params.targetDate),
        infoRow("種別", MOD_TYPE_LABEL[params.modType] ?? params.modType),
        infoRow("修正前", params.beforeValue),
        infoRow("修正後", params.afterValue),
        infoRow("理由", params.reason),
      ],
    },
    footer: {
      type: "box", layout: "vertical",
      contents: [
        {
          type: "button", style: "primary", color: "#2563EB",
          action: { type: "uri", label: "確認・承認する", uri: params.approvalUrl },
        },
      ],
    },
  };

  return { type: "flex", altText: `打刻修正申請: ${params.employeeName}（${params.targetDate}）`, contents: bubble };
}

/**
 * 有給申請通知（管理者向け）
 */
export function buildLeaveRequestMessage(params: {
  employeeName: string;
  targetDate: string;
  leaveType: string;
  remainingDays: number;
  reason: string | null;
  approvalUrl: string;
}): FlexMessage {
  const bodyContents: object[] = [
    infoRow("申請者", params.employeeName),
    infoRow("対象日", params.targetDate),
    infoRow("種別", LEAVE_TYPE_LABEL[params.leaveType] ?? params.leaveType),
    infoRow("残日数", `${params.remainingDays}日`),
  ];
  if (params.reason) bodyContents.push(infoRow("理由", params.reason));

  const bubble = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical",
      backgroundColor: "#7C3AED",
      paddingAll: "15px",
      contents: [
        { type: "text", text: "🔔 休暇申請", color: "#FFFFFF", weight: "bold", size: "md" },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: bodyContents ,
    },
    footer: {
      type: "box", layout: "vertical",
      contents: [
        {
          type: "button", style: "primary", color: "#7C3AED",
          action: { type: "uri", label: "確認・承認する", uri: params.approvalUrl },
        },
      ],
    },
  };

  return { type: "flex", altText: `休暇申請: ${params.employeeName}（${params.targetDate}）`, contents: bubble };
}

/**
 * 承認結果通知（従業員向け）
 */
export function buildApprovalResultMessage(params: {
  type: "modification" | "leave";
  targetDate: string;
  detail: string;
  approved: boolean;
  rejectionReason?: string;
}): FlexMessage {
  const approved = params.approved;
  const title = approved ? "✅ 申請が承認されました" : "❌ 申請が差し戻されました";
  const color = approved ? "#16A34A" : "#DC2626";

  const bodyContents: object[] = [
    { type: "text", text: `${params.targetDate}の`, size: "sm", wrap: true },
    { type: "text", text: `${params.detail}が${approved ? "承認" : "差し戻し"}されました`, size: "sm", wrap: true },
  ];

  if (!approved && params.rejectionReason) {
    bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push(infoRow("理由", params.rejectionReason));
  }

  const bubble = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical",
      backgroundColor: color,
      paddingAll: "15px",
      contents: [
        { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "md" },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: bodyContents ,
    },
  };

  return { type: "flex", altText: title, contents: bubble };
}

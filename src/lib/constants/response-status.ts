// T-133 P2: 箱A（CandidateFile BOOKMARK）の仕分けステータス定数。
// 値は箱B（kyuujinPDF）の feedback_status と同一文字列（P4切替時に変換不要にするため）。
export const RESPONSE_STATUS_VALUES = [
  "UNANSWERED",
  "INTERESTED",
  "APPLY",
  "PENDING",
  "EXCLUDED",
  "IN_SELECTION",
  "SELECTION_ENDED",
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUS_VALUES)[number];

export function isResponseStatus(v: unknown): v is ResponseStatus {
  return typeof v === "string" && (RESPONSE_STATUS_VALUES as readonly string[]).includes(v);
}

// actor=user（求職者本人）が設定できる値。EXCLUDED は CA/管理者のみ（現行 /site/ 仕様）。
// IN_SELECTION / SELECTION_ENDED は READONLY（CA駆動・mypage ca-status.ts の READONLY_STATUSES と対応）。
export const USER_SETTABLE_STATUSES: ReadonlySet<ResponseStatus> = new Set([
  "UNANSWERED",
  "INTERESTED",
  "APPLY",
  "PENDING",
]);

// まとめ送信の差分対象（箱B submit の「未送信かつ status != none」相当。UNANSWERED は差分に含まれない）。
export const SUBMITTABLE_STATUSES: ReadonlySet<ResponseStatus> = new Set([
  "INTERESTED",
  "APPLY",
  "PENDING",
]);

// portal 応募意向（CandidateJobResponse.response）へのマッピング。
// 箱B feedback-status ハンドラの _PORTAL_INTENT_MAP と同一（INTERESTED/APPLY/UNANSWERED のみ同期、
// PENDING/EXCLUDED/IN_SELECTION/SELECTION_ENDED は同期しない=undefined）。null は「取り消し（削除）」。
export const PORTAL_INTENT_MAP: Record<string, "INTERESTED" | "WANT_TO_APPLY" | null | undefined> = {
  INTERESTED: "INTERESTED",
  APPLY: "WANT_TO_APPLY",
  UNANSWERED: null,
};

export const EXCLUDED_ACTOR_VALUES = ["user", "ca"] as const;
export type ExcludedActor = (typeof EXCLUDED_ACTOR_VALUES)[number];

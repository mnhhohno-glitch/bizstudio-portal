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
// null は「取り消し（該当行を削除）」、undefined は「同期対象外（CJR に触らない）」。
//
// PENDING / EXCLUDED も null（削除）に含める:
//   旧実装は箱B の _PORTAL_INTENT_MAP に合わせて UNANSWERED のみ削除していたため、
//   「気になる」→「保留」/「対象外」に変更しても CandidateJobResponse の INTERESTED 行が残り、
//   マイページ回答タスクの全量リストやブックマークのフラグ表示が実態とズレていた。
//   仕分けで候補者の意向から外れた時点で回答レコードも消し、実態と一致させる。
// IN_SELECTION / SELECTION_ENDED は CA駆動の選考進行状態であり、候補者の意向を否定するものでは
//   ないため従来どおり同期対象外（undefined）のまま。
export const PORTAL_INTENT_MAP: Record<string, "INTERESTED" | "WANT_TO_APPLY" | null | undefined> = {
  INTERESTED: "INTERESTED",
  APPLY: "WANT_TO_APPLY",
  UNANSWERED: null,
  PENDING: null,
  EXCLUDED: null,
};

export const EXCLUDED_ACTOR_VALUES = ["user", "ca"] as const;
export type ExcludedActor = (typeof EXCLUDED_ACTOR_VALUES)[number];

// T-189 Phase3-2a: 求職者本人が「対象外」を選んだ理由の定型値（マイページの新着マッチ求人）。
// 「その他」は自由記述（excludeReasonText）を付けて `その他: 本文` の形で CandidateFile.candidateExcludeReason に保存する。
export const CANDIDATE_EXCLUDE_REASON_CHOICES = ["職種が違う", "会社の雰囲気", "年収", "その他"] as const;
export type CandidateExcludeReasonChoice = (typeof CANDIDATE_EXCLUDE_REASON_CHOICES)[number];
export const CANDIDATE_EXCLUDE_REASON_TEXT_MAX = 200;

export function isCandidateExcludeReasonChoice(v: unknown): v is CandidateExcludeReasonChoice {
  return typeof v === "string" && (CANDIDATE_EXCLUDE_REASON_CHOICES as readonly string[]).includes(v);
}

/** 保存形式へ整形: 定型値はそのまま、「その他」は `その他: 本文`（本文は空白正規化・上限200文字）。 */
export function formatCandidateExcludeReason(choice: CandidateExcludeReasonChoice, text: string | null): string {
  if (choice !== "その他") return choice;
  const t = (text ?? "").replace(/\s+/g, " ").trim().slice(0, CANDIDATE_EXCLUDE_REASON_TEXT_MAX);
  return t ? `その他: ${t}` : "その他";
}

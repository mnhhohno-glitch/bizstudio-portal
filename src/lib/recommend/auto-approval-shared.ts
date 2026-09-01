// T-189 Phase3-1: 自動配信の承認ページで server / client の両方が使う定数・型・純関数。
// （auto-approval.ts は prisma を import するため client component から読めない。こちらは副作用なし）

/** 評価 D の自動却下理由（analyze-collect・埋め戻しスクリプト・承認ページ表示で同一文字列を使う） */
export const AUTO_REJECT_REASON_D = "AI評価D（自動）";

/** 却下理由の定型選択肢（「その他」は自由記述1行を付けて `その他: xxx` で保存） */
export const REJECT_REASON_CHOICES = [
  "職種が合わない",
  "会社タイプが合わない",
  "年収",
  "通勤",
  "その他",
] as const;
export type RejectReasonChoice = (typeof REJECT_REASON_CHOICES)[number];

/**
 * 1日の自動引き当て上限（job-platform 側の自動検索が1求職者につき1日に送ってくる最大件数）。
 * 一覧の「当日上限到達」は JST 当日の autoSourcedAt 件数がこの値以上かで判定する。
 */
export const AUTO_DAILY_CAP = 5;

/** ランク内訳のキー（表示順）。null / 想定外値は「未評価」に寄せる */
export const RANK_KEYS = ["A", "B+", "B", "C", "D", "未評価"] as const;
export type RankKey = (typeof RANK_KEYS)[number];

export function toRankKey(rating: string | null | undefined): RankKey {
  return rating && (RANK_KEYS as readonly string[]).includes(rating) ? (rating as RankKey) : "未評価";
}

/** 自動由来行の会社名。fileName は `求人票_<会社名>_<番号>.pdf`（from-job-platform の buildFileName） */
export function companyNameFromFileName(fileName: string): string {
  return fileName
    .replace(/^求人票_/, "")
    .replace(/\.pdf$/i, "")
    .replace(/_\d+$/, "")
    .trim() || fileName;
}

/* ---------- API レスポンスの型（client と共有） ---------- */

export type AutoApprovalOverviewRow = {
  candidateId: string;
  candidateNumber: string;
  name: string;
  employeeName: string | null; // 担当CA
  pendingCount: number;
  rankCounts: Record<RankKey, number>; // 承認待ちのランク内訳
  approvedUnreadCount: number; // 公開済み（APPROVED）のうち JOB_VIEW ログが無い求人数
  approvedCount: number;
  lastLineSentAt: string | null;
  lastLoginAt: string | null;
  todayCount: number; // JST 当日の引き当て件数
  dailyCapReached: boolean;
};

export type AutoApprovalCard = {
  id: string;
  companyName: string;
  jobTitle: string | null;
  jobCategory: string | null;
  externalJobRef: string | null;
  jobUrl: string | null; // memo に保存された求人URL
  aiMatchRating: string | null;
  aiAnalysisComment: string | null;
  aiAnalyzedAt: string | null;
  autoSourcedAt: string | null; // 引き当て日
  approvalStatus: string | null;
  rejectedReason: string | null;
  introducedAt: string | null;
  hasPdf: boolean; // driveFileId が付いているか（承認時PDF生成の成否）
  viewed: boolean; // 求職者が求人詳細を開いたか（JOB_VIEW ログ）
};

export type AutoApprovalDetail = {
  candidate: {
    id: string;
    candidateNumber: string;
    name: string;
    autoRecommendEnabled: boolean;
    lastLineSentAt: string | null;
  };
  pending: AutoApprovalCard[];
  approved: AutoApprovalCard[];
  rejected: AutoApprovalCard[]; // 直近のみ（参考表示）
  expired: AutoApprovalCard[]; // 直近のみ（参考表示）
};

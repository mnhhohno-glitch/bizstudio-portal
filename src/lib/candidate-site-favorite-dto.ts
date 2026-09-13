// T-189 Phase3-2a: 求職者サイト向け favorites API の返却 DTO（ホワイトリスト）を共通化。
// 元は /api/external/candidate-site/favorites/route.ts 内のローカル定義（型・select・toDTO・ヘルパ）を
// そのまま切り出したもの（挙動・フィールド構成は切り出し前と同一）。
// 新設の auto-matches API（承認済みの自動配信求人）が同じ DTO 形で返すために共有する。
//
// 方針: 求職者に見せてよい項目だけを明示的に列挙する。手数料・媒体・raw な AI分析文（CA向け選考分析）は載せない。
import { SUBMITTABLE_STATUSES } from "@/lib/constants/response-status";
import { extractRecommendationForDisplay } from "@/lib/comment-split";

// fileName（求人票_{会社名}_{10桁以上ID}.pdf / 求人票_{会社名}.pdf）から会社名をベストエフォート抽出。
// 旧PDF等で形式が違う場合は null（fileName 自体はそのまま返すので情報は落ちない）。
export function parseCompanyFromFileName(fileName: string): string | null {
  const n = fileName.replace(/\.pdf$/i, "");
  const m = n.match(/^求人票_(.+?)(?:_\d{10,})?$/);
  return m ? m[1] : null;
}

// T-131 step3a: externalJobRef が付いた行（＝job-platformに紐付いた求人。CA/本人が保存したjp求人と、
// PDFアップから自動フルデータ化された紐付け済み求人の両方）を「jp形」に正規化して返す。
//   - sourceJobId = externalJobRef（job-platformの媒体内ID。フル詳細/AI解説の取得キー）
//   - sourceType = "job-platform"（PDF由来でも紐付け済みは job-platform 扱いに昇格）
// これで既存jp行とT-131紐付け行のレスポンス形が一致し、求職者サイト側は区別できず自動でフルカード表示になる。
// externalJobRef（内部列名）は互換のため当面併記する（消費側がsourceJobIdへ移行後に削れる）。
export function jpNormalize(
  externalJobRef: string | null,
  storedSourceType: string | null,
): { sourceJobId: string | null; sourceType: string | null } {
  if (externalJobRef) return { sourceJobId: externalJobRef, sourceType: "job-platform" };
  return { sourceJobId: null, sourceType: storedSourceType };
}

// T-133 P2: 未送信の仕分け変更フラグ（差分送信の対象になるか）。
// 対象 = INTERESTED/APPLY/PENDING かつ（未送信 or 送信後に変更）。response-submission API の差分抽出と同一解釈。
export function computeHasUnsubmittedChange(f: {
  responseStatus: string | null;
  responseStatusUpdatedAt: Date | null;
  responseSubmittedAt: Date | null;
}): boolean {
  if (!f.responseStatus || !SUBMITTABLE_STATUSES.has(f.responseStatus as never)) return false;
  if (!f.responseStatusUpdatedAt) return false;
  if (!f.responseSubmittedAt) return true;
  return f.responseStatusUpdatedAt.getTime() > f.responseSubmittedAt.getTime();
}

export type FavoriteDTO = {
  id: string;
  externalJobRef: string | null;
  /** job-platform 媒体内ID（紐付け済み行のみ・= externalJobRef）。フル詳細/AI解説の取得キー。 */
  sourceJobId: string | null;
  /** kyuujinPDF の Job 内部ID（jobs.id・Int）。PDF由来求人を会社名照合せず直接引くための鍵。未紐付けは null。 */
  kyuujinJobId: number | null;
  /** T-133 P2: 箱A内製の仕分けステータス（7値・箱B feedback_status と同一文字列）。null=未仕分け（UNANSWERED相当）。 */
  responseStatus: string | null;
  /** T-133 P2: CA手動の◎○△（aiMatchRating A-D とは別系統）。 */
  caMatchLabel: string | null;
  /** T-133 P2: 紹介日時（ISO）。null=未設定。 */
  introducedAt: string | null;
  /** T-133 P2: 現在の仕分けを最後にまとめ送信した日時（ISO）。null=未送信。 */
  responseSubmittedAt: string | null;
  /** T-133 P2: 未送信の仕分け変更があるか（INTERESTED/APPLY/PENDING かつ 送信後に変更 or 未送信）。 */
  hasUnsubmittedChange: boolean;
  sourceType: string | null;
  origin: "ca" | "candidate";
  fileName: string;
  companyName: string | null;
  jobUrl: string | null;
  candidateNote: string | null; // 求職者本人のメモ（本人が編集可）
  caComment: string | null; // CAアドバイザーコメント（求職者からは読み取り専用）
  /** T-133 FU-13a: CAによる求職者向け表示の上書き（13項目のキー→上書き文字列）。null=上書きなし。mypage BFF が元データにマージ。 */
  displayOverrides: Record<string, string> | null;
  /** T-133 FU-14a: CAによる手動並び順。null=手動順なし（従来ソート）。小さいほど先頭。favorites は既にこの順で返る。 */
  displayOrder: number | null;
  /** ピックアップ: CAが「先頭固定」を付けた日時（ISO）。null=非ピックアップ。上限3件／求職者は API 側で判定。 */
  pickedUpAt: string | null;
  /**
   * 本人向けおすすめポイント本文（フェイルクローズ）。ai_analysis_comment から「◆ おすすめポイント（本人向け）」
   * 本文だけを切り出したもの。両見出し（本人向け＋CA向け）が正順で揃う分析のみ値が入り、それ以外は null。
   * CA向けの選考分析（通過率・懸念点等）は一切含まない。生の ai_analysis_comment はレスポンスに載せない。
   */
  aiRecommendation: string | null;
  aiMatchRating: string | null;
  createdAt: string;
  applied: boolean;
};

/** toFavoriteDTO が必要とする列（favorites GET / POST / PATCH と auto-matches GET で共通の select）。 */
export const FAVORITE_DTO_SELECT = {
  id: true,
  externalJobRef: true,
  kyuujinJobId: true,
  sourceType: true,
  origin: true,
  fileName: true,
  memo: true,
  candidateNote: true,
  caComment: true,
  // 生の分析文。レスポンスには載せず、本人向け部分の切り出し（aiRecommendation）にのみ使う。
  aiAnalysisComment: true,
  displayOverrides: true,
  displayOrder: true,
  pickedUpAt: true,
  aiMatchRating: true,
  responseStatus: true,
  responseStatusUpdatedAt: true,
  responseSubmittedAt: true,
  caMatchLabel: true,
  introducedAt: true,
  createdAt: true,
} as const;

export type FavoriteRow = {
  id: string;
  externalJobRef: string | null;
  kyuujinJobId: number | null;
  responseStatus: string | null;
  responseStatusUpdatedAt: Date | null;
  responseSubmittedAt: Date | null;
  caMatchLabel: string | null;
  introducedAt: Date | null;
  sourceType: string | null;
  origin: string | null;
  fileName: string;
  memo: string | null;
  candidateNote: string | null;
  caComment: string | null;
  aiAnalysisComment: string | null;
  displayOverrides: unknown;
  displayOrder: number | null;
  pickedUpAt: Date | null;
  aiMatchRating: string | null;
  createdAt: Date;
};

// DTO 変換（applied は呼び出し側が持つ場合のみ true）。
export function toFavoriteDTO(f: FavoriteRow, applied: boolean): FavoriteDTO {
  const jp = jpNormalize(f.externalJobRef, f.sourceType);
  return {
    id: f.id,
    externalJobRef: f.externalJobRef,
    sourceJobId: jp.sourceJobId,
    kyuujinJobId: f.kyuujinJobId,
    responseStatus: f.responseStatus,
    caMatchLabel: f.caMatchLabel,
    introducedAt: f.introducedAt ? f.introducedAt.toISOString() : null,
    responseSubmittedAt: f.responseSubmittedAt ? f.responseSubmittedAt.toISOString() : null,
    hasUnsubmittedChange: computeHasUnsubmittedChange(f),
    sourceType: jp.sourceType,
    origin: f.origin === "candidate" ? "candidate" : "ca", // null/"ca" は CA 追加として正規化
    fileName: f.fileName,
    companyName: parseCompanyFromFileName(f.fileName),
    jobUrl: f.memo,
    candidateNote: f.candidateNote,
    caComment: f.caComment,
    displayOverrides: (f.displayOverrides ?? null) as Record<string, string> | null,
    displayOrder: f.displayOrder,
    pickedUpAt: f.pickedUpAt ? f.pickedUpAt.toISOString() : null,
    // フェイルクローズ切り出し。生の aiAnalysisComment はレスポンスに含めない（本人向け本文のみ）。
    aiRecommendation: extractRecommendationForDisplay(f.aiAnalysisComment),
    aiMatchRating: f.aiMatchRating,
    createdAt: f.createdAt.toISOString(),
    applied,
  };
}

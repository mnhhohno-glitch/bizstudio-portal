// T-205 step3〜step8: 最初の整理の書き方を変えた日時（JST・最後に変えたコミットの時刻）。これより前に作られた整理には「作り直す」の案内を出す。
// step8 以降は summary_json の有無でも判定する（無い部屋は文章表示のまま・作り直すとカード表示）。
// 画面（クライアント）からも読むため、Anthropic SDK を読み込む chat.ts とは分けている。
// T-208 step3（2026-09-30）: questions に company（関わる会社）を足した。これより前のカード表示の部屋には「作り直すと会社ごとに振り分けられます」の案内。
export const INTERVIEW_PREP_FORMAT_UPDATED_AT = "2026-09-30T08:50:00+09:00";

export function isOldPrepFormat(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && t < new Date(INTERVIEW_PREP_FORMAT_UPDATED_AT).getTime();
}

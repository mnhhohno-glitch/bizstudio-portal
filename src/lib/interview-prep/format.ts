// T-205 step3: 最初の整理の書き方を変えた日時（JST）。これより前に作られた整理には「作り直す」の案内を出す。
// 画面（クライアント）からも読むため、Anthropic SDK を読み込む chat.ts とは分けている。
export const INTERVIEW_PREP_FORMAT_UPDATED_AT = "2026-09-27T09:45:00+09:00";

export function isOldPrepFormat(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && t < new Date(INTERVIEW_PREP_FORMAT_UPDATED_AT).getTime();
}

// T-066: クライアント側で JST 日付文字列を返す薄いヘルパ。
// jstDate.ts と同じロジックだが、サーバ側の prisma 等を引きずらないように分離。
export function todayJstDateStringClient(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

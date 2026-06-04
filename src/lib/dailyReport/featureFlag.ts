// T-066: 日報機能の feature flag。
// 環境変数 DAILY_REPORT_ENABLED が "true" の場合のみ有効。
// デフォルト OFF。Railway で `true` をセットするだけで本番有効化できる。
export function isDailyReportEnabled(): boolean {
  return process.env.DAILY_REPORT_ENABLED === "true";
}

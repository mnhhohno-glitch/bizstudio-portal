// T-189: おすすめ配信（自動引き当て）の管理者判定。
// AUTO_RECOMMEND_ADMIN_IDS はカンマ区切りの User.id または email。未設定なら誰も管理者にしない。
// 表示可否（/api/auth/session）と更新権限（/api/candidates/[id]/update の autoRecommendEnabled）の
// 両方がこの1関数を使う（判定のズレ防止）。

export function isAutoRecommendAdmin(user: { id: string; email: string }): boolean {
  const adminIds = (process.env.AUTO_RECOMMEND_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return adminIds.includes(user.id) || adminIds.includes(user.email);
}

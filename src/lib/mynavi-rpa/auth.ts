/**
 * RPA からの API 呼び出しを x-rpa-secret ヘッダで認証する。
 * @returns 認証成功なら true
 */
export function verifyRpaSecret(req: Request): boolean {
  const secret = process.env.RPA_API_SECRET;
  if (!secret) {
    console.error("[mynavi-rpa/auth] RPA_API_SECRET が設定されていません");
    return false;
  }
  const provided = req.headers.get("x-rpa-secret");
  return provided === secret;
}

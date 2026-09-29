// T-207: LINE WORKS の友だち追加URLの形式判定。
// 社員管理の入力欄（注意文の表示）とサーバ側で共用する。クライアント・サーバどちらからも import 可（依存なし）。

export const LINE_WORKS_URL_PREFIX = "https://works.do/";

/** `https://works.do/` で始まる文字列なら true。空文字・null は false。 */
export function isLineWorksUrl(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v.startsWith(LINE_WORKS_URL_PREFIX);
}

/**
 * 時刻入力の全角文字を半角に変換する。
 * - 全角数字 ０〜９ → 半角 0〜9
 * - 全角コロン ： → 半角 :
 * - コロンなし4桁数字（例: "1400"）→ "HH:MM" に補完
 * - 空文字や不正形式はそのまま返す
 */
export function normalizeTimeInput(value: string): string {
  if (!value) return value;

  let result = value.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );

  result = result.replace(/：/g, ":");

  result = result.trim();

  if (/^\d{4}$/.test(result)) {
    result = `${result.slice(0, 2)}:${result.slice(2)}`;
  }

  return result;
}

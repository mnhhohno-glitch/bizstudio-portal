/**
 * 電話番号を正規化（数字のみに統一）
 * - 全角数字を半角化
 * - ハイフン・空白・括弧などを除去
 * - 国際表記 +81 → 0 変換
 * - 結果が10桁または11桁でなければ不正データとして null を返す
 */
export function normalizePhoneNumber(
  input: string | null | undefined,
): string | null {
  if (!input) return null;

  // 全角→半角変換（数字・記号・スペース）
  let s = input.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  s = s.replace(/　/g, " ");

  // 国際表記 +81 → 0
  s = s.trim();
  if (s.startsWith("+81")) {
    s = "0" + s.slice(3);
  } else if (s.startsWith("81") && s.length >= 11) {
    // 81始まりで十分な桁数があれば国番号とみなす
    s = "0" + s.slice(2);
  }

  // 数字以外をすべて除去
  const digits = s.replace(/\D/g, "");

  if (digits.length !== 10 && digits.length !== 11) {
    return null;
  }

  return digits;
}

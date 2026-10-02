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

/**
 * フリー検索用: NFKC（全角→半角）後に数字以外をすべて除去する。桁数チェックはしない。
 */
export function phoneDigits(input: string | null | undefined): string {
  if (!input) return "";
  return input.normalize("NFKC").replace(/\D/g, "");
}

// ハイフン類・空白・括弧（NFKC 前の全角も含む）
const PHONE_QUERY_SEPARATORS = /[-‐‑‒–—―−ーｰ－\s()（）［］[\]]/g;

/**
 * フリー検索語を電話番号照合用の数字列にする。
 * 区切り（ハイフン類・空白・括弧）を除いた結果が数字のみ・4桁以上のときだけ返し、それ以外は null。
 */
export function phoneSearchQuery(q: string): string | null {
  const s = q.normalize("NFKC").replace(PHONE_QUERY_SEPARATORS, "");
  return /^\d{4,}$/.test(s) ? s : null;
}

/** 保存値の電話番号が検索語に部分一致するか（書式・全角差は無視）。検索語が電話番号扱いでなければ false */
export function phoneMatchesSearch(phone: string | null | undefined, q: string): boolean {
  const needle = phoneSearchQuery(q);
  if (!needle) return false;
  return phoneDigits(phone).includes(needle);
}

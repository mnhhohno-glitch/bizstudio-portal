/**
 * マイナビRPA新フローの送信可否判定ロジック
 */

/**
 * 年齢判定：生年月日から満年齢を算出し、40歳以上なら true（送信NG）
 */
export function isAgeNg(birthDate: Date): boolean {
  return calculateAge(birthDate) >= 40;
}

/**
 * 生年月日から満年齢を算出
 */
export function calculateAge(birthDate: Date): number {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// カタカナ（中黒・長音・スペースを許容）のみ
const KATAKANA_ONLY = /^[゠-ヿㇰ-ㇿ・ー\s]+$/;
// 英字（一般的な人名記号を許容）のみ
const ENGLISH_ONLY = /^[A-Za-z\s.'-]+$/;
// カタカナと英字の混在
const KATAKANA_OR_ENGLISH = /^[゠-ヿㇰ-ㇿ・ーA-Za-z\s.'-]+$/;
// 漢字
const HAS_KANJI = /[一-鿿]/;

/**
 * 1つの名前パートが「日本語以外（カタカナ or 英語）」かどうか
 */
function isNonJapanesePart(part: string): boolean {
  const s = (part || "").trim();
  if (!s) return false;
  if (HAS_KANJI.test(s)) return false;
  return KATAKANA_ONLY.test(s) || ENGLISH_ONLY.test(s) || KATAKANA_OR_ENGLISH.test(s);
}

/**
 * 外国籍判定：姓と名の両方がカタカナまたは英語のみの場合のみ true（送信NG）
 * - 姓または名のどちらかに漢字が1文字でも含まれていれば日本人扱い（false）
 */
export function isForeignNg(lastName: string, firstName: string): boolean {
  const last = (lastName || "").trim();
  const first = (firstName || "").trim();

  // 漢字が姓名どちらかに含まれていれば日本人
  if (HAS_KANJI.test(last) || HAS_KANJI.test(first)) {
    return false;
  }

  // 姓・名の両方が日本語以外のとき外国籍とみなす
  return isNonJapanesePart(last) && isNonJapanesePart(first);
}

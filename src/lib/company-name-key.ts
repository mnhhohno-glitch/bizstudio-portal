// 求職者選択モード Phase 1a: 会社名の「同社判定キー」正規化。
//
// ⚠️ 出所（規則の複製元）: bizstudio-job-platform `src/lib/ingest/normalize.ts`
//     - normalizeCompanyName()  (L135)  … 本ファイル normalizeCompanyKey() と同一規則
//     - nfkcText()              (L90)
//     - LEGAL_FORMS             (L7)
//     - toHalfWidthAlnum()      (L30)
//   job-platform 側では companies.normalized_name_key（同社dedupキー）の生成に使われている。
//   portal は job-platform の DB を直接引けないため、**同一入力→同一キー**になるよう規則をこちらに複製する。
//   job-platform 側の normalize.ts を変更する際は、本ファイルも必ず同時に更新すること（キーがずれると同社判定が壊れる）。

/** 法人格。出現位置を問わず全除去する（長いものが先＝医療法人社団 > 医療法人）。 */
const LEGAL_FORMS = [
  "株式会社",
  "（株）",
  "(株)",
  "㈱",
  "有限会社",
  "（有）",
  "(有)",
  "㈲",
  "合同会社",
  "一般社団法人",
  "公益社団法人",
  "一般財団法人",
  "公益財団法人",
  "学校法人",
  "医療法人社団",
  "医療法人",
  "社会福祉法人",
  "特定非営利活動法人",
  "NPO法人",
];

/** 全角英数字を半角に変換する（NFKC後は冗長だが job-platform と手順を揃える）。 */
function toHalfWidthAlnum(s: string): string {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** CJK部首補助 → 統合漢字。 */
const RADICAL_SUPPLEMENT_MAP: Record<string, string> = {
  "⺠": "民",
  "⻄": "西",
  "⻑": "長",
  "⻘": "青",
  "⻝": "食",
  "⻤": "鬼",
  "⻨": "麦",
  "⻫": "斉",
  "⻭": "歯",
  "⻯": "竜",
  "⻲": "亀",
};
const RADICAL_SUPPLEMENT_RE = new RegExp(`[${Object.keys(RADICAL_SUPPLEMENT_MAP).join("")}]`, "g");

/** 異体字 → 常用字形（戶 U+6236 → 戸 U+6238）。 */
const VARIANT_IDEOGRAPH_MAP: Record<string, string> = {
  "戶": "戸",
};
const VARIANT_IDEOGRAPH_RE = new RegExp(`[${Object.keys(VARIANT_IDEOGRAPH_MAP).join("")}]`, "g");

/** 検索用統一正規化: NFKC ＋ CJK部首補助の統合漢字化 ＋ 異体字の常用字形化。 */
export function nfkcText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(RADICAL_SUPPLEMENT_RE, (c) => RADICAL_SUPPLEMENT_MAP[c])
    .replace(VARIANT_IDEOGRAPH_RE, (c) => VARIANT_IDEOGRAPH_MAP[c]);
}

/**
 * 会社名 → 同社判定キー。job-platform の normalizeCompanyName と同一規則。
 * 例: 「株式会社カシワバラ・コーポレーション」→「カシワバラコーポレーション」
 *
 * 手順（job-platform と同順）:
 *   1. nfkcText（NFKC＋部首補助fold＋異体字fold）
 *   2. trim
 *   3. 法人格を全除去（出現位置問わず）
 *   4. 全角英数 → 半角
 *   5. 英数・ひらがな・カタカナ・長音・々・漢字 以外を全除去（空白/記号/括弧が消える）
 *   6. 中点「・」(U+30FB) を明示除去（カタカナブロック内のため5で残る）
 *   7. 小文字化
 */
export function normalizeCompanyKey(name: string): string {
  let s = nfkcText(name).trim();
  for (const form of LEGAL_FORMS) {
    s = s.split(form).join("");
  }
  s = toHalfWidthAlnum(s);
  s = s.replace(/[^0-9A-Za-z぀-ゟ゠-ヿ々㐀-鿿]/g, "").replace(/・/g, "");
  return s.toLowerCase();
}

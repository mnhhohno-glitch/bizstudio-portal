/**
 * Strip file-level metadata (extension, kyuujin prefixes, timestamps, Bee suffixes)
 * to extract the company-name portion of a bookmark PDF filename.
 *
 * Handles all known portal/kyuujinPDF filename patterns:
 *   求人票_会社名_20260413194430596.pdf
 *   32893_会社名.pdf
 *   会社名_No123.pdf
 *   会社名：141427.pdf  (Bee)
 */
export function stripFileMetadata(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/^求人票[_]?/, "")
    .replace(/^\d+_/, "")
    .replace(/_\d{10,}$/, "")
    .replace(/[：:]\d+$/, "")
    .replace(/_No\d+$/i, "")
    .trim();
}

const CORP_SUFFIXES = /株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g;

export function stripCorpSuffixes(name: string): string {
  return name.replace(CORP_SUFFIXES, "").trim();
}

/* ============================================================================
 * 会社名コアの抽出（T-146 追加調査）
 *
 * 背景: ブックマークのファイル名には会社名以外の文字が混ざることがある。
 *   例) マンパワーグループ株式会社【西日本営業本部】_営業事務.pdf
 *       エム・シー・ヘルスケア株式会社（医療現場を支える総合ソリューション企業）.pdf
 *       池下工業株式会社_No441005_《★未経験歓迎！…》♦年休124日／…
 * AI分析の出力見出しは「【会社名】」の形なので、照合は
 *   【[^】]*検索名[^】]*】
 * で行われる。検索名に上記の不純物が残っていると構造上マッチせず、
 * analyze-batch がセクションを取り出せずに評価の保存ごとスキップされる
 * （ログ: [AnalyzeBatch] Phase2 failed to extract section, skipping partial save）。
 * 本番で 105 件・求職者 52 名がこの状態だった。
 *
 * ★設計方針★ 呼び出し側（extractSearchNames）では、既存の候補配列は一切変えず
 * 本関数の返り値を**末尾に追加するだけ**にすること。候補は先頭から順に試され
 * 最初の一致で確定するため、現在成功している照合は今までどおり先に確定する
 * ＝デグレしない（実データ 6,263 件で候補列の先頭が変化しないことを確認済み）。
 *
 * 調査の詳細: docs/survey_T-146_company_name_extraction.md
 * ========================================================================= */

/** 法人格。長い方を先に並べる（医療法人社団 が 医療法人 に食われないように） */
const LEGAL_ENTITY =
  "株式会社|有限会社|合同会社|合資会社|一般財団法人|公益財団法人|一般社団法人" +
  "|医療法人社団|医療法人|学校法人|社会福祉法人|特定非営利活動法人|独立行政法人|国立大学法人";

/** 会社名には通常現れない区切り。ここ以降はキャッチコピー・部署名・補足とみなす */
const NOISE_DELIMITER = /[_＿（(【《〔[、／/|｜※＼★◆♦☆▼●〇■□〜~]|\s-\s/;

/**
 * R0: ファイル固有のメタデータを落として「会社名らしき部分」の種を作る。
 * stripFileMetadata との違いは末尾 `_No12345_`（末尾アンダースコア付き）と
 * 末尾の全角空白にも対応する点。順序に意味がある（trim してから _No を落とす）。
 */
function seedName(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/^求人票[_]?/, "")
    .replace(/^\d+_/, "")
    .replace(/_\d{10,}$/, "")
    .replace(/[：:]\d+$/, "")
    .trim()
    .replace(/_No\d+_?$/i, "")
    .trim();
}

/** R1: 法人格が後置なら、その直後で切る（マンパワーグループ株式会社【…】→ マンパワーグループ株式会社） */
function cutAfterLegalEntity(s: string): string | null {
  const m = s.match(new RegExp(`^(.{1,40}?(?:${LEGAL_ENTITY}))`));
  return m && m[1].length < s.length ? m[1] : null;
}

/** R2: 区切り記号以降を落とす（株式会社サンドラッグ_【神奈川／…】→ 株式会社サンドラッグ） */
function cutAtNoiseDelimiter(s: string): string | null {
  const m = s.match(NOISE_DELIMITER);
  // index が 0/1 のものは会社名が残らないので採らない
  return m && m.index !== undefined && m.index >= 2 ? s.slice(0, m.index).trim() : null;
}

/**
 * ファイル名から「会社名コア」の候補を返す。該当が無ければ空配列。
 * 返り値は呼び出し側の既存候補の**末尾**に足すこと（先頭に入れるとデグレする）。
 */
export function extractCompanyNameCandidates(fileName: string): string[] {
  const seed = seedName(fileName);
  const out: string[] = [];
  const push = (v: string | null) => {
    if (!v) return;
    const n = v.replace(/　/g, " ").trim();
    if (n.length >= 2 && !out.includes(n)) out.push(n);
    const stripped = n.replace(new RegExp(LEGAL_ENTITY, "g"), "").trim();
    if (stripped.length >= 2 && !out.includes(stripped)) out.push(stripped);
  };
  push(cutAfterLegalEntity(seed));
  push(cutAtNoiseDelimiter(seed));
  push(seed);
  return out;
}

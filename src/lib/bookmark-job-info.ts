// T-184: 求人評価モーダルに出す「求人情報（CA向け）」の抽出。
//
// データ源は CandidateFile.extractedText（求人本文）のみ。AI は使わず、保存済みテキストから
// 素直に切り出すだけ（都度解析なし）。job-platform への追加APIも不要。
//   - job-platform 由来の行（externalJobRef あり）: 「【仕事内容】」「【会社情報】」の構造化テキスト
//   - CA手動アップPDF / kyuujin 由来の行: 構造化されていない PDF テキスト。取れる項目だけ拾い、
//     取れないものは null（＝画面では「(データなし)」）。捏造はしない。
//
// ⚠️ ここで返す値は CA 専用。求職者向け出力（マイページ / 紹介文 / コピー）には一切載せない。

/** job-platform 構造化テキストの「トップレベル見出し」。仕事内容ブロックの終端判定に使う。 */
const SECTION_HEADINGS = [
  "会社名", "求人タイトル", "職種", "雇用形態", "勤務地", "想定年収", "年間休日", "固定残業", "学歴",
  "必要業務経験・応募条件", "必要業務経験", "歓迎条件", "歓迎要件",
  "給与・待遇（詳細）", "給与・待遇", "給与‧待遇", "賃金形態", "試用期間", "試用期間の説明",
  "休日・休暇（詳細）", "休日・休暇", "休日‧休暇", "年間休日日数",
  "福利厚生（詳細）", "福利厚生", "管理監督職有無", "受動喫煙対策", "会社情報",
];

/** 会社概要として拾う行のキー（PDFテキスト行のフォールバック用）。 */
const COMPANY_KEYS = ["業種", "事業内容", "会社概要", "所在地", "設立年", "設立", "資本金", "上場区分", "企業URL", "売上高", "代表者"];

/** 仕事内容が長すぎる場合の上限（表示は全文スクロールだが、異常テキストでの暴走を防ぐ）。 */
const MAX_DESCRIPTION_CHARS = 8000;

function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/\r/g, "").trim();
  return s.length ? s : null;
}

/**
 * 「【見出し】」直後から、次のトップレベル見出し（または本文末尾）までを取り出す。
 * ブロック内に入れ子の【…】（例: 【仕事内容変更の範囲】）があっても、SECTION_HEADINGS に
 * 無いものは終端扱いしない＝本文が途中で切れない。
 */
function extractSection(text: string, heading: string): string | null {
  const start = text.indexOf(`【${heading}】`);
  if (start < 0) return null;
  const bodyStart = start + heading.length + 2;
  const rest = text.slice(bodyStart);
  let end = rest.length;
  for (const h of SECTION_HEADINGS) {
    if (h === heading) continue;
    const i = rest.indexOf(`【${h}】`);
    if (i >= 0 && i < end) end = i;
  }
  return clean(rest.slice(0, end));
}

export type BookmarkJobInfo = {
  /** 仕事内容（改行を保持した長文）。取得できなければ null。 */
  jobDescription: string | null;
  /** 従業員数（「480名」「1001 ~ 5000名」等の生値）。取得できなければ null。 */
  employeeCount: string | null;
  /** 会社概要（業種・所在地・企業URL 等。従業員数は別項目のため除く）。取得できなければ null。 */
  companyOverview: string | null;
};

/** 求人本文テキストから 仕事内容 / 従業員数 / 会社概要 を抽出する。取れない項目は null。 */
export function extractJobInfoFromText(text: string | null | undefined): BookmarkJobInfo {
  const empty: BookmarkJobInfo = { jobDescription: null, employeeCount: null, companyOverview: null };
  const t = clean(text);
  if (!t) return empty;

  // --- 仕事内容 ---
  let jobDescription = extractSection(t, "仕事内容");
  if (jobDescription) {
    // 構造化テキストは「【仕事内容】\n【仕事内容】\n本文」と見出しが二重になることがあるため、
    // 先頭の重複見出し行だけ落とす（本文中の【…】は残す）。
    jobDescription = clean(jobDescription.replace(/^【仕事内容】\s*\n/, ""));
  }
  if (jobDescription && jobDescription.length > MAX_DESCRIPTION_CHARS) {
    jobDescription = jobDescription.slice(0, MAX_DESCRIPTION_CHARS) + "\n…（以下省略）";
  }

  // --- 従業員数 ---（構造化・PDFテキストとも「従業員数: xxx」行で書かれる）
  const empMatch = t.match(/従業員数\s*[:：]\s*([^\n]+)/);
  const employeeCount = empMatch ? clean(empMatch[1]) : null;

  // --- 会社概要 ---
  let companyOverview: string | null = null;
  const companyBlock = extractSection(t, "会社情報");
  if (companyBlock) {
    // 従業員数は独立項目として出すので、会社概要からは落とす（重複表示を避ける）。
    companyOverview = clean(
      companyBlock.split("\n").filter((line) => !/^\s*従業員数\s*[:：]/.test(line)).join("\n")
    );
  } else {
    // PDFテキスト（構造化されていない）: 会社概要に相当するキー行だけを拾う。
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const rawLine of t.split("\n")) {
      const line = rawLine.trim();
      const m = line.match(/^([^\s:：]{2,8})\s*[:：]\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      if (!COMPANY_KEYS.includes(key) || key === "従業員数") continue;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(`${key}: ${m[2].trim()}`);
      if (picked.length >= 10) break;
    }
    companyOverview = picked.length ? picked.join("\n") : null;
  }

  return { jobDescription, employeeCount, companyOverview };
}

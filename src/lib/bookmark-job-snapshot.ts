// T-185: ブックマーク行（CandidateFile / category="BOOKMARK"）から求人名・職種を取り出す共通処理。
//
// 背景: ブックマーク由来のエントリー（JobEntry）に求人名が入らない不具合。
//   - CA がブックマークした行（/api/external/bookmarks/from-job-platform）は job_title 列を一切
//     書いていなかった（payload の jobTitle を受け取りながら捨てていた）。本番 7,851 行すべて NULL。
//   - 本人がサイトで追加した行（/api/external/candidate-site/favorites）は mypage が jobTitle を
//     送ってきたときのみ保存されるため、送信元が対応する前の行は NULL。
//   その結果、to-entry（ブックマーク→エントリー）で `jobTitle: f.jobTitle ?? ""` が常に "" になり、
//   紹介履歴のエントリー区分が会社名だけの表示になっていた。
//
// 求人名のデータ源は以下の優先順（上ほど確実）。取れないときは null を返し、捏造はしない。
//   1. CandidateFile.jobTitle（favorites POST が mypage から受け取って保存した値）
//   2. extractedText の構造化ブロック（job-platform が送る「【求人タイトル】」形式）
//   3. extractedText の HITO-Link PDF テキスト形式（「求人名<タイトル>」行）
//   4. 同一 externalJobRef を持つ他行（他の求職者のブックマークでも求人自体は同一）の 1〜3
//      ※ 4 は呼び出し側が候補行を渡したときのみ効く（この関数は純粋・DBを引かない）。

/** job-platform が送る構造化テキストの「【求人タイトル】」直後の行。 */
const STRUCTURED_TITLE_RE = /【求人タイトル】\s*\r?\n\s*([^\r\n]+)/;
/** 同じく「【職種】」直後の行。 */
const STRUCTURED_CATEGORY_RE = /【職種】\s*\r?\n\s*([^\r\n]+)/;
/** HITO-Link 求人票 PDF のテキスト形式（「求人ID：...」の次行が「求人名<タイトル>」）。 */
const HITOLINK_TITLE_RE = /^求人名\s*(.+)$/m;

function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return s.length ? s : null;
}

/** 求人本文テキストから求人名を抽出する。取れなければ null。 */
export function extractJobTitleFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m1 = text.match(STRUCTURED_TITLE_RE);
  if (m1) return clean(m1[1]);
  const m2 = text.match(HITOLINK_TITLE_RE);
  if (m2) return clean(m2[1]);
  return null;
}

/** 求人本文テキストから職種を抽出する。構造化テキストのみ対応（PDFテキストは形式が一定でないため取らない）。 */
export function extractJobCategoryFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(STRUCTURED_CATEGORY_RE);
  return m ? clean(m[1]) : null;
}

export type BookmarkSnapshotSource = {
  jobTitle?: string | null;
  jobCategory?: string | null;
  extractedText?: string | null;
};

/**
 * ブックマーク行（＋同一求人の代替行）から求人名・職種を解決する。
 * @param primary   対象のブックマーク行
 * @param fallbacks 同一 externalJobRef を持つ他行（任意・順に試す）
 */
export function resolveBookmarkJobSnapshot(
  primary: BookmarkSnapshotSource,
  fallbacks: BookmarkSnapshotSource[] = [],
): { jobTitle: string | null; jobCategory: string | null } {
  let jobTitle: string | null = null;
  let jobCategory: string | null = null;

  for (const row of [primary, ...fallbacks]) {
    jobTitle ??= clean(row.jobTitle) ?? extractJobTitleFromText(row.extractedText);
    jobCategory ??= clean(row.jobCategory) ?? extractJobCategoryFromText(row.extractedText);
    if (jobTitle && jobCategory) break;
  }

  return { jobTitle, jobCategory };
}

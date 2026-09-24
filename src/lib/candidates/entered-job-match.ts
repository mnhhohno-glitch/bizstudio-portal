// 紹介履歴（HistoryTab）の本人回答表示を「エントリー」に差し替えるための突き合わせ。
// 表示専用。本人回答データ（CandidateFile.responseStatus / CandidateJobResponse / kyuujinPDF JobFeedback）は書き換えない。
//
// エントリー済み = JobEntry.entryFlag が ENTERED_ENTRY_FLAGS のいずれか（03-portal-spec のエントリー集計定義と同じ）。
//   「求人紹介」は紹介しただけなので含めない。本番実値（2026-09-24）: 求人紹介/書類選考/面接/エントリー/内定/入社済/検討中(1件)。
//   見送り・辞退は entryFlag ではなく entryFlagDetail 側の値で、応募到達済みなので entryFlag で判定すれば含まれる。
//
// 突き合わせ（ファイル行×エントリーの組ごと）:
//   1. キー一致: CandidateFile.externalJobRef === JobEntry.externalJobRef（to-entry の重複判定と同じ求人単位キー）
//   2. キー一致: ファイルの ref が "hl-ap-<番号>" で、ref を持たない HITO-Link エントリー（FileMaker 移行分）の
//      externalJobNo と番号一致
//   3. 会社名一致: 上の1・2でキー比較できない組だけ（キー比較できて不一致＝別求人なので会社名では拾わない）。
//      正規化は jobResponseMap と同じ normalize(stripCorpSuffixes(...))。照合は「ファイル名キーが会社名を含む」の片方向のみ
//      （逆方向も見ると「プレックス」が「テレビ朝日メディアプレックス」に一致する誤判定が本番で出た）。
//      同じ会社の別職種もまとめて一致するのは許容（仕様）。
import { stripCorpSuffixes, stripFileMetadata } from "@/lib/normalize-filename";

export const ENTERED_ENTRY_FLAGS: ReadonlySet<string> = new Set(["応募", "エントリー", "書類選考", "面接", "内定", "入社済"]);

export type EnteredEntryLike = {
  entryFlag?: string | null;
  companyName: string;
  jobDb?: string | null;
  externalJobRef?: string | null;
  externalJobNo?: string | null;
};

export type EnteredMatch = "key" | "company" | null;

type IndexedEntry = { companyKey: string; ref: string | null; hitoLinkNo: string | null };
export type EnteredJobIndex = IndexedEntry[];

// 1文字の会社名キーは部分一致で無関係な行を巻き込むため照合しない。
const MIN_COMPANY_KEY_LEN = 2;
// 移行データの externalJobNo には "1" "61" 等の番号でない値が混じる。HITO-Link 求人番号とみなすのは5桁以上だけ。
const HITO_LINK_NO = /^\d{5,}$/;

function normalizeKey(s: string): string {
  return stripCorpSuffixes(s).normalize("NFKC").toLowerCase();
}

export function buildEnteredJobIndex(entries: EnteredEntryLike[]): EnteredJobIndex {
  const idx: EnteredJobIndex = [];
  for (const e of entries) {
    if (!e.entryFlag || !ENTERED_ENTRY_FLAGS.has(e.entryFlag)) continue;
    const no = e.externalJobNo?.trim() ?? "";
    idx.push({
      // 移行データの会社名には「36190_ミラタップ」「KITEN_No370201」のようなファイル名由来の付帯が残るため同じ除去をかける。
      companyKey: normalizeKey(stripFileMetadata(e.companyName ?? "")),
      ref: e.externalJobRef || null,
      hitoLinkNo: !e.externalJobRef && /hito/i.test(e.jobDb ?? "") && HITO_LINK_NO.test(no) ? no : null,
    });
  }
  return idx;
}

export function matchEnteredJob(
  file: { fileName: string; externalJobRef?: string | null },
  idx: EnteredJobIndex,
): EnteredMatch {
  if (idx.length === 0) return null;
  const ref = file.externalJobRef || null;
  const hlNo = ref ? /^hl-ap-(\d+)$/.exec(ref)?.[1] ?? null : null;
  const fileKey = normalizeKey(stripFileMetadata(file.fileName));
  let company = false;
  for (const e of idx) {
    if (ref && e.ref) {
      if (ref === e.ref) return "key";
      continue;
    }
    if (hlNo && e.hitoLinkNo) {
      if (hlNo === e.hitoLinkNo) return "key";
      continue;
    }
    if (
      !company &&
      fileKey.length >= MIN_COMPANY_KEY_LEN &&
      e.companyKey.length >= MIN_COMPANY_KEY_LEN &&
      fileKey.includes(e.companyKey)
    ) {
      company = true;
    }
  }
  return company ? "company" : null;
}

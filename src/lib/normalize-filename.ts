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

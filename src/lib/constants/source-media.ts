// T-128 Phase2-1: job-platform 経由求人の元媒体（source_media）→ 媒体名（jobDb）マッピング。
// エントリー作成時に kyuujinPDF 由来の job_db='マイナビJOB' / job_id=内部連番 を上書きするために使用。

// sourceMedia（job-platform 側で保存される小文字識別子）→ 媒体名（JOB_TYPE_BY_ROUTE / ENTRY_ROUTE_OPTIONS のキー）
// 未知値・null は null 返却（呼び出し側で従来動作にフォールバック）。
export const SOURCE_MEDIA_TO_JOBDB: Record<string, string> = {
  hito_link: "HITO-Link",
  circus: "Circus",
  bee: "Bee",
  mynavi_jobshare: "マイナビJOB",
};

/**
 * ブックマークの sourceType / sourceMedia から jobDb（媒体名）を解決する。
 * - sourceType !== "job-platform": null（従来動作に任せる）
 * - sourceType === "job-platform":
 *   - sourceMedia がマッピングにあればそれを返す
 *   - sourceMedia が null / 未知の場合は暫定で "HITO-Link"
 *     （T-128 Phase2-1 時点: job-platform 求人は 100% HITO-Link（74,038件実測）。
 *       job-platform 側から sourceMedia が来るようになれば自動的にマッピング値が採用される）
 */
export function resolveJobDbFromBookmark(
  sourceType: string | null | undefined,
  sourceMedia: string | null | undefined,
): string | null {
  if (sourceType !== "job-platform") return null;
  if (sourceMedia && SOURCE_MEDIA_TO_JOBDB[sourceMedia]) {
    return SOURCE_MEDIA_TO_JOBDB[sourceMedia];
  }
  // 暫定フォールバック（sourceType="job-platform" && sourceMedia が来ていない場合）
  return "HITO-Link";
}

/**
 * externalJobRef の末尾の連続数字を「実求人番号」として取り出す。
 *   hl-ap-320645       → 320645（HITO-Link 実求人番号）
 *   liginc-101323      → 101323
 *   ptw-000001         → 000001
 *   circus-kiwjza      → null（circus 系は job-platform 割当のランダムスラッグで実求人番号ではない）
 *   own-xxxx           → null（末尾に数字がない場合）
 *   （T-140: null 返しに修正。旧実装は末尾数字なし時に ref 全体を返し、externalJobNo に
 *     "circus-kiwjza" のような無意味値が入っていた。表示・突合・DB照合で破綻するため null 化する）
 */
export function extractJobNoFromRef(externalJobRef: string | null | undefined): string | null {
  if (!externalJobRef) return null;
  const m = externalJobRef.match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

/**
 * externalJobRef（job-platform の source_job_id）の接頭辞から媒体名を判定する。
 * ブックマーク一覧の「DB名」列表示用（sourceMedia 未設定行のフォールバック）。
 *
 * 実データ（2026-07-16 本番アクティブBOOKMARK 5,149件調査）の接頭辞分布に基づく:
 *   own-*             2,296件 → 自社
 *   circus-*          1,809件 → Circus
 *   hl-ap-*             495件 → HITO-Link
 *   mynavi_jobshare-*    97件 → マイナビJOB
 *   その他4件（daikonet-gr / hackazouk / kaitoru / shoeisha）は HITO-Link ネイティブの
 *     複合slug。うち3件は sourceMedia="hito_link" を持つため呼び出し側の sourceMedia 優先で解決される。
 *     接頭辞だけでは一意判定できないため、ここでは null を返す（DB名列は「—」表示）。
 *
 * 注意: sourceMedia が設定されている行はそちらを優先すること（resolveBookmarkMedia 参照）。
 */
export function resolveMediaFromRef(externalJobRef: string | null | undefined): string | null {
  if (!externalJobRef) return null;
  if (externalJobRef.startsWith("hl-ap-")) return "HITO-Link";
  if (externalJobRef.startsWith("circus-")) return "Circus";
  if (externalJobRef.startsWith("own-")) return "自社";
  // job-platform 実データは 'mynavi_jobshare-'。将来の 'mynavi-' 接頭辞にも念のため対応。
  if (externalJobRef.startsWith("mynavi_jobshare-") || externalJobRef.startsWith("mynavi-")) {
    return "マイナビJOB";
  }
  return null;
}

/**
 * ブックマーク行の媒体名（DB名）を解決する。
 * sourceMedia（job-platform webhook 由来・9.7%）を優先し、無ければ externalJobRef の接頭辞で判定。
 * どちらでも判定できなければ null（一覧では「—」表示）。
 */
export function resolveBookmarkMedia(
  sourceMedia: string | null | undefined,
  externalJobRef: string | null | undefined,
): string | null {
  if (sourceMedia && SOURCE_MEDIA_TO_JOBDB[sourceMedia]) {
    return SOURCE_MEDIA_TO_JOBDB[sourceMedia];
  }
  return resolveMediaFromRef(externalJobRef);
}

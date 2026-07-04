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
 * externalJobRef の末尾の連続数字を求人番号として取り出す。
 *   hl-ap-320645 → 320645
 *   liginc-101323 → 101323
 *   ptw-000001 → 000001
 *   （末尾に数字が無い場合は externalJobRef 全体をそのまま返す）
 */
export function extractJobNoFromRef(externalJobRef: string | null | undefined): string | null {
  if (!externalJobRef) return null;
  const m = externalJobRef.match(/(\d+)\s*$/);
  return m ? m[1] : externalJobRef;
}

import { toast } from "sonner";

// portal SSO 経由で bizstudio-job-platform の求人詳細ページを新規タブで開く。
//   1. /api/auth/issue-app-token(target_app="job_platform") で 5分TTL の App Token を発行
//   2. target_url(例: https://bizstudio-job-platform.vercel.app/jobs) + ?auth_token=&id=<externalJobRef>
//   3. window.open(_blank, noopener,noreferrer)
// externalJobRef は job-platform 側 source_job_id(例: hl-ap-321185 / circus-kiwjza / own-... / mynavi_jobshare-...)。
// HistoryTab のブックマーク一覧「DBNO」列と、EntryTable のサイト経由エントリー「企業名」クリックの両方で使う。
// 呼び出し側は自身で in-flight ガード(二重クリック防止)を持つこと(setOpeningRef 等)。
export async function openJobPlatformDetail(externalJobRef: string): Promise<void> {
  return openJobPlatform({ id: externalJobRef });
}

// T-189 追加: portal SSO 経由で job-platform の**求人検索画面**を新規タブで開く。
//   queryString（配信条件パターンの query_string＝ /jobs のURLクエリ文字列）を渡すと、
//   その検索条件が適用された状態で開く（クエリ引き継ぎ「可」）。
//
// 注意（クエリ引き継ぎの範囲）: job-platform の「求職者選択モード」はページ内のクライアント state で
//   あり URL パラメータでは復元できない（cand/exj/exc は "紹介済みを除く" 用で、モードOFFのまま
//   ロードすると ExcludeUrlSync が掃除する）。したがってモードと求職者の選択は CA が画面上で行う。
//   ここで引き継げるのは**検索条件だけ**。
export async function openJobPlatformSearch(queryString?: string | null): Promise<void> {
  return openJobPlatform({ queryString: queryString ?? undefined });
}

async function openJobPlatform(opts: { id?: string; queryString?: string }): Promise<void> {
  try {
    const res = await fetch("/api/auth/issue-app-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_app: "job_platform" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      toast.error(err?.error || "求人ページを開けませんでした");
      return;
    }
    const { token, target_url } = await res.json();
    let url = `${target_url}?auth_token=${encodeURIComponent(token)}`;
    if (opts.id) url += `&id=${encodeURIComponent(opts.id)}`;
    // queryString は job-platform 側で保存された /jobs 用のクエリ文字列。そのまま連結する
    // （portal 側で解釈・再構築しない＝条件の二重実装を作らない）。
    if (opts.queryString) url += `&${opts.queryString.replace(/^[?&]+/, "")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    toast.error("求人ページを開けませんでした");
  }
}

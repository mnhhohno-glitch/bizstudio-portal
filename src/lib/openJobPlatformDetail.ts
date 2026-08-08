import { toast } from "sonner";

// portal SSO 経由で bizstudio-job-platform の求人詳細ページを新規タブで開く。
//   1. /api/auth/issue-app-token(target_app="job_platform") で 5分TTL の App Token を発行
//   2. target_url(例: https://bizstudio-job-platform.vercel.app/jobs) + ?auth_token=&id=<externalJobRef>
//   3. window.open(_blank, noopener,noreferrer)
// externalJobRef は job-platform 側 source_job_id(例: hl-ap-321185 / circus-kiwjza / own-... / mynavi_jobshare-...)。
// HistoryTab のブックマーク一覧「DBNO」列と、EntryTable のサイト経由エントリー「企業名」クリックの両方で使う。
// 呼び出し側は自身で in-flight ガード(二重クリック防止)を持つこと(setOpeningRef 等)。
export async function openJobPlatformDetail(externalJobRef: string): Promise<void> {
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
    const url = `${target_url}?auth_token=${encodeURIComponent(token)}&id=${encodeURIComponent(externalJobRef)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    toast.error("求人ページを開けませんでした");
  }
}

// T-189 追加: job-platform の「即時引き当て」API を叩くクライアント。
//
// 契約（job-platform 側の実装が正）:
//   POST {JOB_PLATFORM_URL}/api/internal/recommend/run
//     headers: x-internal-key: INTERNAL_INGEST_API_KEY（portal → job-platform の既存内部鍵。
//              submitPdfToJobPlatform と同じ鍵・同じヘッダ名）
//     body: { candidateNumber, max? }
//     200 → { mode, hit, adopted, sent: { created, skipped, error }, jobs: [...] }
//     404 → 配信条件が未保存（求人サイトで検索条件を保存してもらう必要がある）
//     429 → 60秒以内の連打
//
// created された求人は job-platform 側から portal の自動配信受け口（origin="auto"）へ
// 送り込まれる。portal 側はその後 AI評価バッチへ投入するだけでよい。

// job-platform（Vercel）の安定本番URL。env で上書き可能。
// JOB_PLATFORM_INGEST_URL は T-131 で既に使っている同一ホストの env（両方未設定なら定数）。
const JOB_PLATFORM_BASE =
  process.env.JOB_PLATFORM_URL ??
  process.env.JOB_PLATFORM_INGEST_URL ??
  "https://bizstudio-job-platform.vercel.app";

// 検索 → 採用 → PDF化 → portal 送信まで走るため長い。余裕を持って240秒。
const RUN_TIMEOUT_MS = 240_000;

export type RecommendRunJob = {
  sourceJobId?: string;
  title?: string;
  company?: string;
  [k: string]: unknown;
};

export type RecommendRunOk = {
  ok: true;
  mode: string;
  hit: number;
  adopted: number;
  sent: { created: number; skipped: number; error: number };
  jobs: RecommendRunJob[];
};

export type RecommendRunNg = {
  ok: false;
  /** HTTP ステータス（fetch 自体が失敗した場合は 0） */
  status: number;
  error: string;
};

export type RecommendRunResult = RecommendRunOk | RecommendRunNg;

/**
 * job-platform に即時引き当てを依頼する（HTTPのみ・DB書込なし）。
 * INTERNAL_INGEST_API_KEY 未設定なら fail-closed（送らずエラーを返す）。
 */
export async function runRecommendOnJobPlatform(args: {
  candidateNumber: string;
  max?: number;
}): Promise<RecommendRunResult> {
  const key = process.env.INTERNAL_INGEST_API_KEY;
  if (!key || key.trim() === "") {
    return { ok: false, status: 0, error: "INTERNAL_INGEST_API_KEY 未設定（fail-closed）" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const res = await fetch(`${JOB_PLATFORM_BASE}/api/internal/recommend/run`, {
      method: "POST",
      headers: { "x-internal-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateNumber: args.candidateNumber,
        ...(args.max !== undefined ? { max: args.max } : {}),
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
      };
    }
    const sent = (json.sent ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      mode: typeof json.mode === "string" ? json.mode : "unknown",
      hit: Number(json.hit ?? 0),
      adopted: Number(json.adopted ?? 0),
      sent: {
        created: Number(sent.created ?? 0),
        skipped: Number(sent.skipped ?? 0),
        error: Number(sent.error ?? 0),
      },
      jobs: Array.isArray(json.jobs) ? (json.jobs as RecommendRunJob[]) : [],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

// T-189 追加: job-platform の「配信条件（パターン）」読み出しクライアント（サーバー間）。
//
// 契約（job-platform 側の実装が正: src/app/api/internal/candidate-search-conditions/[candidateNumber]/route.ts）:
//   GET {JOB_PLATFORM_URL}/api/internal/candidate-search-conditions/{candidateNumber}
//     headers: x-internal-key: INTERNAL_INGEST_API_KEY（引き当てAPIと同じ鍵・同じヘッダ名）
//     200 → { candidateNumber, patterns: [{ id, label, summary, queryString, enabled, updatedAt }],
//              enabledCount, ...互換トップレベル（queryString/label/enabled/summary 等） }
//     404 → パターン0件（＝配信条件が未登録）
//
// 用途は2つ:
//   ① 求職者詳細のパターン一覧表示（/api/candidates/[id]/recommend-conditions 経由）
//   ② 自動配信 OFF→ON のサーバー側ガード（enabledCount>=1 でなければ ON にしない）
// ②があるため **通信失敗は「条件あり」とみなさない**（fail-closed）。呼び出し側は ok:false を
// 「不明＝ONにしない」として扱うこと。

const JOB_PLATFORM_BASE =
  process.env.JOB_PLATFORM_URL ??
  process.env.JOB_PLATFORM_INGEST_URL ??
  "https://bizstudio-job-platform.vercel.app";

// 単純な読み出し。画面のトグル操作を待たせるため短め。
const FETCH_TIMEOUT_MS = 10_000;

export type ConditionPattern = {
  id: string;
  label: string;
  /** 人が読める1行要約（job-platform 側で生成。portal では条件を再解釈しない） */
  summary: string;
  /** /jobs のURLクエリ文字列（page/id/exj/exc/cand は保存時に除去済み） */
  queryString: string;
  /** 自動配信に使うか（false＝保存のみ） */
  enabled: boolean;
  updatedAt: string | null;
};

export type ConditionsOk = {
  ok: true;
  patterns: ConditionPattern[];
  /** enabled=true のパターン数。0 なら自動配信 ON にしてはいけない。 */
  enabledCount: number;
};

export type ConditionsNg = {
  ok: false;
  /** HTTP ステータス（fetch 自体が失敗した場合は 0） */
  status: number;
  error: string;
};

export type ConditionsResult = ConditionsOk | ConditionsNg;

function toPattern(raw: unknown): ConditionPattern | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    label: typeof r.label === "string" ? r.label : "(名称なし)",
    summary: typeof r.summary === "string" ? r.summary : "",
    queryString: typeof r.queryString === "string" ? r.queryString : "",
    enabled: r.enabled === true,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

/**
 * 配信条件パターンを取得する（HTTPのみ・DB書込なし）。
 * - 404（パターン0件）は ok:true / patterns:[] / enabledCount:0 として返す（「無い」ことが分かっている状態）。
 * - 鍵未設定・タイムアウト・5xx は ok:false（＝不明。ON のガードでは拒否する側に倒すこと）。
 */
export async function fetchCandidateConditions(args: {
  candidateNumber: string;
}): Promise<ConditionsResult> {
  const key = process.env.INTERNAL_INGEST_API_KEY;
  if (!key || key.trim() === "") {
    return { ok: false, status: 0, error: "INTERNAL_INGEST_API_KEY 未設定（fail-closed）" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${JOB_PLATFORM_BASE}/api/internal/candidate-search-conditions/${encodeURIComponent(args.candidateNumber)}`,
      { method: "GET", headers: { "x-internal-key": key }, signal: controller.signal, cache: "no-store" },
    );
    if (res.status === 404) {
      // 「パターン0件」。job-platform の API 応答（JSON）であることまでは問わない
      // ―― 未デプロイなら 401/HTML404 ではなく引き当て側で検知される。ここでは
      // 未登録と同じ「ONにできない」に落ちるため、どちらでも安全側で一致する。
      return { ok: true, patterns: [], enabledCount: 0 };
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, status: res.status, error: `JSON以外の応答（HTTP ${res.status}）` };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
      };
    }
    const patterns = Array.isArray(json.patterns)
      ? (json.patterns.map(toPattern).filter((p): p is ConditionPattern => p !== null))
      : [];
    // enabledCount は job-platform が返すが、欠けていた場合は patterns から数える（互換）。
    const enabledCount =
      typeof json.enabledCount === "number"
        ? json.enabledCount
        : patterns.filter((p) => p.enabled).length;
    return { ok: true, patterns, enabledCount };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

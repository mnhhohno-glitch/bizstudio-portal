// T-XXX step2: AI（ChatGPT カスタムGPT / Claude）向け CA別実績 読み取り専用 API。
//
// GET /api/ai/ca-kpi?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=month|week|day&caId=1000001&groups=interview,entry
//   - 完全読み取り専用（GET 以外は export しない）。AI 呼び出しも行わない。
//   - 認証は company-kpi と同じ Bearer AI_READ_API_KEY（src/lib/aiRead/auth.ts）。
//   - 本文の組み立ては src/lib/aiRead/caKpiResponse.ts（step3 で切り出し。MCP ツール get_ca_kpi と同じ関数）。
//     定義・注意点・上限・数え方の説明もそちらにある。

import { assertAiReadAuth } from "@/lib/aiRead/auth";
import { buildCaKpiResponse } from "@/lib/aiRead/caKpiResponse";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request) {
  const deny = assertAiReadAuth(req);
  if (deny) return deny;

  const result = await buildCaKpiResponse(new URL(req.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}

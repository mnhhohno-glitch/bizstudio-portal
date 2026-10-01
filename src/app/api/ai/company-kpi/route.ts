// T-190: AI（Claude / ChatGPT）向け 経営数値 読み取り専用 API。
//
// GET /api/ai/company-kpi?year=YYYY&month=YYYY-MM
//   - 完全読み取り専用。INSERT/UPDATE/DELETE は一切行わない（GET 以外も export しない）。
//   - 認証は Bearer AI_READ_API_KEY（src/lib/aiRead/auth.ts）。
//   - 本文の組み立ては src/lib/aiRead/companyKpiResponse.ts（T-XXX step3 で切り出し。MCP ツール get_company_kpi と同じ関数）。
//     定義・数え方・スコープ（CA_ONLY）の説明もそちらにある。

import { assertAiReadAuth } from "@/lib/aiRead/auth";
import { buildCompanyKpiResponse } from "@/lib/aiRead/companyKpiResponse";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request) {
  const deny = assertAiReadAuth(req);
  if (deny) return deny;

  const { searchParams } = new URL(req.url);
  const result = await buildCompanyKpiResponse({ year: searchParams.get("year"), month: searchParams.get("month") });
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}

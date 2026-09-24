// T-213: 実行履歴タブ用の内部 API（GET /api/scout/runs?from=&to=&machines=1,2&dry=1&q=&page=）。
// 認証はログインセッション（getSessionUser）。RPA 向けの外部 API（/api/external/scout-conditions/runs）とは別物で、
// そちらのレスポンス構造・受け入れ処理には触れていない。絞り込み・ページングは run-history.ts。
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { fetchRunHistory, parseRunHistoryQuery } from "@/lib/scout-conditions/run-history";

export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const query = parseRunHistoryQuery(request.nextUrl.searchParams);
  const res = await fetchRunHistory(query);
  return NextResponse.json(res);
}

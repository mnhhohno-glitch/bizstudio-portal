// T-195: POST /api/external/scout-conditions/runs
// RPA（PAD）が配信のたびに結果を直接送る口。契約は docs/rpa/scout-conditions-api.md（変更禁止）。
// 認証: x-api-secret = EXTERNAL_API_SECRET（不一致は 401）。401 以外はエラーでも HTTP 200 で ok:false。
// 本体（記録・枯渇判定・予約消化・通知・タスク起票）は src/lib/scout-conditions/runs.ts。
import { NextResponse } from "next/server";
import { isAuthorizedExternal } from "@/lib/schedule-tasks";
import { parseRunInput, recordScoutRun, type RunResult } from "@/lib/scout-conditions/runs";

export const dynamic = "force-dynamic";

function respond(r: RunResult) {
  // 全レスポンスで同じキー集合（PAD はキー欠落で例外停止する）
  return NextResponse.json({
    ok: r.ok,
    runId: r.runId,
    isDry: r.isDry,
    switched: r.switched,
    currentConditionId: r.currentConditionId,
    queueEmpty: r.queueEmpty,
    message: r.message,
  });
}

export async function POST(request: Request) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = parseRunInput(body);
  if (!parsed.ok) {
    return respond({ ok: false, runId: null, isDry: null, switched: false, currentConditionId: null, queueEmpty: null, message: parsed.error });
  }
  try {
    const r = await recordScoutRun(parsed.data);
    if (r.queueEmptyOutcome?.missingAssignees.length) {
      console.warn(`[external/scout-conditions/runs] 担当者未解決: ${r.queueEmptyOutcome.missingAssignees.join("・")}`);
    }
    return respond(r);
  } catch (e) {
    console.error("[external/scout-conditions/runs] failed:", e);
    return respond({ ok: false, runId: null, isDry: null, switched: false, currentConditionId: null, queueEmpty: null, message: "サーバー内部エラー" });
  }
}

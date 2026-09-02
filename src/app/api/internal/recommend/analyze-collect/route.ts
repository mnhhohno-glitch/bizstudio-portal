import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { runAnalyzeCollect } from "@/lib/recommend/analyze-batch-run";

// T-189 Phase 2a: Message Batches API へ投入したAI評価の結果回収。
//
// POST /api/internal/recommend/analyze-collect?dry_run=<true|false>&confirm=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。analyze-submit と同一。
//   - 二段ガード: 本回収（DB保存）は dry_run=false かつ confirm=true の時のみ。
//     それ以外は DRY-RUN（未回収バッチの processing_status を照会して返すだけ・書き込みなし）。
//   - 流れ: RecommendAnalyzeBatch.status="SUBMITTED" の行を batchId ごとにまとめ、
//     batches.retrieve → processing_status="ended" のバッチだけ results() をストリームで読む。
//     custom_id（=台帳行 id）で fileIds を引き当て、succeeded は CA画面経路と同一の
//     解析・保存関数（applyAnalysisResults・fail-closed）で3軸を保存する。
//     マーカー不揃いで保存されなかったファイルは aiAnalyzedAt が null のままなので、
//     翌日の analyze-submit が自動的に再投入する（無人リトライ）。
//   - usage は recordAdvisorUsage(endpoint="recommend-analyze", batchApi=true) で記録する。
//   - errored / canceled → status="FAILED"、expired → status="EXPIRED"。
//     24時間を超えても ended にならないバッチの行は EXPIRED にする。
//
// 処理本体は src/lib/recommend/analyze-batch-run.ts（画面の「今すぐ探す」と共用）。

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRunParam = sp.get("dry_run");
  const dryRun = dryRunParam === "1" || dryRunParam === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;

  try {
    const result = await runAnalyzeCollect({ willExecute });
    return NextResponse.json({ willExecute, ...result });
  } catch (e) {
    console.error("[recommend/analyze-collect] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

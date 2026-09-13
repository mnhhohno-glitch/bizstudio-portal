import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { runAnalyzeSubmit } from "@/lib/recommend/analyze-batch-run";

// T-189 Phase 2a: 自動引き当てブックマークのAI評価を Anthropic Message Batches API（50%割引）へ投入する。
//
// POST /api/internal/recommend/analyze-submit?dry_run=<true|false>&confirm=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。resubmit-stale / auto-expire と同一の内部鍵。
//   - 二段ガード: 実投入は dry_run=false かつ confirm=true の両方が揃った時のみ。
//     それ以外は DRY-RUN（対象件数・リクエスト構成・費用試算のみ。Anthropic/DB とも書き込みなし）。
//   - 対象: approvalStatus="PENDING" かつ aiAnalyzedAt IS NULL かつ origin="auto"
//     （＋extractedText あり・archivedAt なし。CA画面 analyze-batch の対象条件と同じ絞り）。
//     既に投入済み（RecommendAnalyzeBatch.status="SUBMITTED"）のファイルは二重投入しない。
//   - 構成: 求職者ごとにまとめ、1リクエスト = 求人最大5件（CA画面の batchSize=5 と同じ）。
//     プロンプトは CA画面経路と同一の lib（analyze-bookmarks.ts）で組み立てる（文言 byte 同一）。
//   - 上限: 1回の投入は RECOMMEND_ANALYZE_MAX_FILES 件（既定 200）。超過分は次回 cron で処理。
//   - 回収は /api/internal/recommend/analyze-collect（別 cron）。
//
// 処理本体は src/lib/recommend/analyze-batch-run.ts（画面の「今すぐ探す」と共用）。
// ここは認証・パラメータ解釈・レスポンス整形だけを行う。

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  // dry_run は "1" / "true" のどちらも受ける（プロンプト仕様は dry_run=1・既存慣例は true）。
  const dryRunParam = sp.get("dry_run");
  const dryRun = dryRunParam === "1" || dryRunParam === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;

  try {
    const result = await runAnalyzeSubmit({ willExecute });
    const { ledgerSaveFailed, ...body } = result;
    if (ledgerSaveFailed) {
      return NextResponse.json(
        { willExecute, ...body, error: "ledger save failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ willExecute, ...body });
  } catch (e) {
    console.error("[recommend/analyze-submit] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

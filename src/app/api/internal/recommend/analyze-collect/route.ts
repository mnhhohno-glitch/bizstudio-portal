import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { anthropic } from "@/lib/claude";
import { recordAdvisorUsage, type AnthropicUsage } from "@/lib/advisor-usage";
import { applyAnalysisResults } from "@/lib/analyze-bookmarks";

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
//   - usage は recordAdvisorUsage(endpoint="recommend-analyze", batchApi=true) で記録する
//     （バッチ割引 ×0.5 を反映。既存の同期経路は従来どおり満額）。
//   - errored / canceled → status="FAILED"、expired → status="EXPIRED"。
//     24時間を超えても ended にならないバッチの行は EXPIRED にする（Anthropic 側も24hで期限切れ）。

export const maxDuration = 300;

const BATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000; // Anthropic Message Batches の期限（24h）

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
    const rows = await prisma.recommendAnalyzeBatch.findMany({
      where: { status: "SUBMITTED" },
      select: { id: true, batchId: true, candidateId: true, fileIds: true, submittedAt: true },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const batchIds = [...new Set(rows.map((r) => r.batchId))];

    let completedRows = 0;
    let failedRows = 0;
    let expiredRows = 0;
    let savedFiles = 0;
    let skippedFiles = 0; // fail-closed（3点セット不揃い）で保存しなかったファイル
    const batchStatuses: { batchId: string; processingStatus: string; rows: number }[] = [];

    for (const batchId of batchIds) {
      const batchRows = rows.filter((r) => r.batchId === batchId);
      let processingStatus = "unknown";
      try {
        const mb = await anthropic.messages.batches.retrieve(batchId);
        processingStatus = mb.processing_status;
      } catch (e) {
        console.error(`[recommend/analyze-collect] retrieve failed batch=${batchId}:`, e);
        batchStatuses.push({ batchId, processingStatus: "retrieve-error", rows: batchRows.length });
        continue;
      }
      batchStatuses.push({ batchId, processingStatus, rows: batchRows.length });

      if (processingStatus !== "ended") {
        // 24h を超えて未完了なら期限切れ扱い（対象ファイルは次回 submit で再投入対象に戻る）。
        const oldest = Math.min(...batchRows.map((r) => r.submittedAt.getTime()));
        if (willExecute && Date.now() - oldest > BATCH_TIMEOUT_MS) {
          await prisma.recommendAnalyzeBatch.updateMany({
            where: { batchId, status: "SUBMITTED" },
            data: { status: "EXPIRED", completedAt: new Date() },
          });
          expiredRows += batchRows.length;
          console.warn(`[recommend/analyze-collect] batch=${batchId} 24h超過のため EXPIRED (${batchRows.length}行)`);
        }
        continue;
      }

      if (!willExecute) continue; // DRY-RUN は照会のみ

      for await (const result of await anthropic.messages.batches.results(batchId)) {
        const row = rowById.get(result.custom_id);
        if (!row || row.batchId !== batchId) continue;
        const fileIds = Array.isArray(row.fileIds)
          ? row.fileIds.filter((v): v is string => typeof v === "string")
          : [];

        if (result.result.type === "succeeded") {
          const message = result.result.message;
          const analysisText = message.content
            .map((b) => (b.type === "text" ? b.text : ""))
            .join("");
          const batchFiles = await prisma.candidateFile.findMany({
            where: { id: { in: fileIds } },
            select: { id: true, fileName: true },
          });
          // CA画面経路と同一の解析・fail-closed 保存（3点セット揃いのみ aiAnalyzedAt/aiMatchRating/
          // aiAnalysisComment を更新。揃わない行は既存値温存＝未評価のまま次回再投入）。
          const { skippedFileIds } = await applyAnalysisResults({
            analysisText,
            batchFiles,
            candidateId: row.candidateId,
            dryRun: false,
          });
          savedFiles += batchFiles.length - skippedFileIds.length;
          skippedFiles += skippedFileIds.length;

          await recordAdvisorUsage({
            endpoint: "recommend-analyze",
            model: message.model,
            usage: message.usage as AnthropicUsage,
            candidateId: row.candidateId,
            fileCount: fileIds.length,
            batchApi: true, // バッチ割引（全トークン種別 ×0.5）を費用計上に反映
            note: `batch=${batchId}`,
          });

          await prisma.recommendAnalyzeBatch.update({
            where: { id: row.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
          completedRows++;
        } else {
          const status = result.result.type === "expired" ? "EXPIRED" : "FAILED";
          console.warn(
            `[recommend/analyze-collect] batch=${batchId} custom_id=${row.id} result=${result.result.type} → ${status} (files=${fileIds.length})`,
          );
          await prisma.recommendAnalyzeBatch.update({
            where: { id: row.id },
            data: { status, completedAt: new Date() },
          });
          if (status === "EXPIRED") expiredRows++;
          else failedRows++;
        }
      }
    }

    return NextResponse.json({
      willExecute,
      mode: willExecute ? "EXECUTE" : "DRY-RUN",
      pendingRows: rows.length,
      batches: batchStatuses,
      completedRows,
      failedRows,
      expiredRows,
      savedFiles,
      skippedFiles,
    });
  } catch (e) {
    console.error("[recommend/analyze-collect] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

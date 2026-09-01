import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { anthropic, CLAUDE_MODEL_ANALYSIS } from "@/lib/claude";
import { buildAnalyzeBatchSystemBlocks } from "@/lib/analyze-batch-cache";
import {
  buildAnalyzeFixedSystem,
  buildBatchInstruction,
  buildAnalyzeCandidateContext,
  buildAnalyzeJobsSection,
} from "@/lib/analyze-bookmarks";
import { randomUUID } from "crypto";

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
//     system は ①固定部（1h TTL cache_control）→ ②候補者context（5分 TTL）→ ③バッチ指示
//     （buildAnalyzeBatchSystemBlocks・844f07b と同じポリシー）。総合まとめは生成しない
//     （常に非最終バッチの指示文で投入する）。
//   - custom_id: RecommendAnalyzeBatch 行の id（UUID）。custom_id → fileIds の対応は同テーブルで持つ。
//   - 上限: 1回の投入は RECOMMEND_ANALYZE_MAX_FILES 件（既定 200）。超過分は次回 cron で処理。
//   - 回収は /api/internal/recommend/analyze-collect（別 cron）。

export const maxDuration = 300;

const BATCH_SIZE = 5; // CA画面（AdvisorFloatingPanel）の batchSize と同一
const DEFAULT_MAX_FILES = 200;

// 費用試算用の概算値（dry_run 表示のみに使用。課金には一切影響しない）。
// トークン≒文字×0.92 は T-189 実測（23,607字→21,308tok / 9,800字→9,449tok）に基づく。
const EST_TOKENS_PER_CHAR = 0.92;
const EST_FIXED_TOKENS = 21308; // FIXED_SYSTEM の実測トークン（count_tokens）
const EST_CONTEXT_TOKENS = 4424; // 候補者context の中央値実測
const EST_OUTPUT_TOKENS_PER_FILE = 1000; // 実測 5,061tok/5件
const PRICE_INPUT_PER_MTOK = 5; // Opus 4.6
const PRICE_OUTPUT_PER_MTOK = 25;
const BATCH_DISCOUNT = 0.5;

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

  const envMax = Number(process.env.RECOMMEND_ANALYZE_MAX_FILES);
  const maxFiles = Number.isInteger(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_FILES;

  try {
    // 1. 対象ファイルの抽出（CA画面の対象条件 + 自動引き当て限定の3条件）。
    const candidates = await prisma.candidateFile.findMany({
      where: {
        category: "BOOKMARK",
        origin: "auto",
        approvalStatus: "PENDING",
        aiAnalyzedAt: null,
        extractedText: { not: null },
        archivedAt: null,
      },
      select: { id: true, candidateId: true, fileName: true, extractedText: true },
      orderBy: { createdAt: "asc" },
    });

    // 2. 投入済み（未回収）のファイルを除外（二重投入防止）。
    //    FAILED / EXPIRED の行は除外しない＝対象ファイルが自動的に再投入対象へ戻る。
    const inFlight = await prisma.recommendAnalyzeBatch.findMany({
      where: { status: "SUBMITTED" },
      select: { fileIds: true },
    });
    const inFlightIds = new Set<string>();
    for (const row of inFlight) {
      if (Array.isArray(row.fileIds)) {
        for (const id of row.fileIds) if (typeof id === "string") inFlightIds.add(id);
      }
    }
    const eligible = candidates.filter((f) => !inFlightIds.has(f.id));

    // 3. 上限適用 → 求職者ごとにグルーピング → 5件ずつのリクエストに分割。
    const capped = eligible.slice(0, maxFiles);
    const byCandidate = new Map<string, typeof capped>();
    for (const f of capped) {
      const arr = byCandidate.get(f.candidateId) ?? [];
      arr.push(f);
      byCandidate.set(f.candidateId, arr);
    }

    type PlannedRequest = {
      customId: string;
      candidateId: string;
      fileIds: string[];
      totalFiles: number; // その求職者の今回対象件数（バッチ指示文の「全N件」）
      start: number;
      end: number;
    };
    const planned: PlannedRequest[] = [];
    for (const [candidateId, files] of byCandidate) {
      for (let start = 0; start < files.length; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE, files.length);
        planned.push({
          customId: randomUUID(),
          candidateId,
          fileIds: files.slice(start, end).map((f) => f.id),
          totalFiles: files.length,
          start,
          end,
        });
      }
    }

    // 4. dry_run: 件数・構成・費用試算のみ返す（context の組み立ても行わない＝副作用ゼロ）。
    const jobChars = capped.reduce(
      (sum, f) => sum + Math.min((f.extractedText ?? "").length, 3000),
      0,
    );
    const estInputTokens = Math.round(
      planned.length * (EST_FIXED_TOKENS + EST_CONTEXT_TOKENS + 500) + jobChars * EST_TOKENS_PER_CHAR,
    );
    const estOutputTokens = capped.length * EST_OUTPUT_TOKENS_PER_FILE;
    const estCostUsd =
      ((estInputTokens * PRICE_INPUT_PER_MTOK + estOutputTokens * PRICE_OUTPUT_PER_MTOK) /
        1_000_000) *
      BATCH_DISCOUNT;
    const estimate = {
      // 概算（キャッシュヒットを考慮しない上限側の試算。実費は cache read/write でこれより下がりうる）
      estInputTokens,
      estOutputTokens,
      estCostUsd: Math.round(estCostUsd * 10000) / 10000,
      estCostJpy: Math.round(estCostUsd * 150),
    };

    const summary = {
      mode: willExecute ? "EXECUTE" : "DRY-RUN",
      targetFiles: capped.length,
      eligibleFiles: eligible.length,
      inFlightFiles: inFlightIds.size,
      maxFiles,
      candidates: byCandidate.size,
      requests: planned.length,
      requestPlan: planned.map((r) => ({
        candidateId: r.candidateId,
        files: r.fileIds.length,
        range: `${r.start + 1}-${r.end}/${r.totalFiles}`,
      })),
      estimate,
    };

    if (!willExecute) {
      return NextResponse.json({ willExecute, ...summary });
    }
    if (planned.length === 0) {
      return NextResponse.json({ willExecute, ...summary, batchId: null });
    }

    // 5. 実投入: 候補者contextを1回ずつ組み立て、全リクエストを1つの Message Batch にまとめる。
    const fixedSystem = buildAnalyzeFixedSystem();
    const fileById = new Map(capped.map((f) => [f.id, f]));
    const contextByCandidate = new Map<string, string>();
    const requests = [];
    for (const r of planned) {
      let context = contextByCandidate.get(r.candidateId);
      if (context === undefined) {
        context = await buildAnalyzeCandidateContext(r.candidateId);
        contextByCandidate.set(r.candidateId, context);
      }
      const batchFiles = r.fileIds.map((id) => fileById.get(id)!);
      const jobsSection = buildAnalyzeJobsSection(batchFiles, r.start);
      const systemBlocks = buildAnalyzeBatchSystemBlocks({
        fixedSystem,
        candidateContext: context,
        // 総合まとめは自動経路では生成しない（常に非最終バッチの指示文）。
        batchInstruction: buildBatchInstruction({
          totalFiles: r.totalFiles,
          start: r.start,
          end: r.end,
          isLastBatch: false,
        }),
      });
      requests.push({
        custom_id: r.customId,
        params: {
          model: CLAUDE_MODEL_ANALYSIS,
          max_tokens: 16000,
          temperature: 0.7,
          system: systemBlocks,
          messages: [
            {
              role: "user" as const,
              content: `## 検討中の求人票（${r.start + 1}〜${r.end}件目 / 全${r.totalFiles}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
            },
          ],
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batch = await anthropic.messages.batches.create({ requests: requests as any });

    // 6. 台帳へ記録（custom_id = 行 id）。ここが失敗すると回収不能になるため、失敗時は
    //    batchId をログに残す（Anthropic Console から手動回収可能。対象ファイルは未評価のまま残り
    //    翌日の submit で再投入される＝評価結果の保存は冪等なので実害は二重課金のみ）。
    try {
      await prisma.recommendAnalyzeBatch.createMany({
        data: planned.map((r) => ({
          id: r.customId,
          batchId: batch.id,
          candidateId: r.candidateId,
          fileIds: r.fileIds,
          status: "SUBMITTED",
        })),
      });
    } catch (dbErr) {
      console.error(
        `[recommend/analyze-submit] 台帳保存に失敗（batchId=${batch.id}）。回収不能のため要調査:`,
        dbErr,
      );
      return NextResponse.json(
        { willExecute, ...summary, batchId: batch.id, error: "ledger save failed" },
        { status: 500 },
      );
    }

    console.log(
      `[recommend/analyze-submit] submitted batch=${batch.id} requests=${planned.length} files=${capped.length}`,
    );
    return NextResponse.json({ willExecute, ...summary, batchId: batch.id });
  } catch (e) {
    console.error("[recommend/analyze-submit] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

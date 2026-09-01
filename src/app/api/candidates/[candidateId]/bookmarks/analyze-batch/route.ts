import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { CLAUDE_MODEL_ANALYSIS } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { RATING_VALUE } from "@/lib/ai-rating";
import { matchCaItemLine } from "@/lib/ca-analysis-format";
import { buildAnalyzeBatchSystemBlocks } from "@/lib/analyze-batch-cache";
// T-189 Phase 2a: プロンプト組み立て・結果解析・fail-closed 保存の本体は lib へ切り出し
//（自動評価経路 /api/internal/recommend/* と共有。文言・出力形式・保存ロジックは不変）。
import {
  hasValidThreeAxisMarkers,
  buildAnalyzeFixedSystem,
  buildBatchInstruction,
  buildAnalyzeCandidateContext,
  buildAnalyzeJobsSection,
  applyAnalysisResults,
} from "@/lib/analyze-bookmarks";

export const maxDuration = 300; // 5 minutes

// T-126 Phase2: 最終バッチの総合まとめ生成に渡す過去バッチ結果を圧縮する。
// 総合まとめに必要なのは「会社名 + 3軸レーティング」のみで、◆推薦本文・◆選考分析の長文は不要。
// 会社名見出し行と ■本人希望/■通過率/■総合 行だけ残し、それ以外の本文を落として入力トークンを削減する。
// ※ 出力フォーマットは一切変えない。圧縮するのは「最終バッチへ渡す入力(履歴)」のみ。
function compressBatchResultForSummary(content: string): string {
  const kept: string[] = [];
  for (const rawLine of content.split("\n")) {
    const t = rawLine.trim();
    if (t === "") continue;
    const noBold = t.replace(/\*\*/g, "");
    // T-180: 選考分析の項目見出し（【固定残業】▲）は会社名見出しではないので落とす。
    if (matchCaItemLine(noBold)) continue;
    // 会社名見出し（## 【…】 / **【…】** / 裸【…】 / 求人N:）
    if (/^(?:#{1,3}\s*)?【[^】]+】/.test(noBold) || /^(?:#{1,3}\s*)?求人\d+[：:]/.test(noBold)) {
      kept.push(t);
      continue;
    }
    // 3軸マーカー行（本人希望 / 通過率 / 総合）
    if (new RegExp(`^■?\\s*(?:本人希望|通過率|総合)\\s*[：:]\\s*${RATING_VALUE}`).test(noBold)) {
      kept.push(t);
      continue;
    }
    // バッチラベル・総合まとめ見出しは残す（文脈保持）
    if (t.startsWith("【求人分析") || t.includes("総合優先順位")) {
      kept.push(t);
      continue;
    }
  }
  // 圧縮で全滅した場合は元テキストにフォールバック（安全策）。
  return kept.length > 0 ? kept.join("\n") : content;
}

const API_TIMEOUT_MS = 300000;
const MAX_CHAT_MESSAGE_CHARS = 4000;

// T-126 Phase2: run 内で候補者context を byte-identical に保つためのプロセス内キャッシュ。
//   getCandidateContext は主要書類を parsePdfWithAI で毎回 OCR するため出力が毎回わずかに変動し、
//   そのままでは system 第2ブロック(候補者context)が cache read されず毎バッチ write(1.25x) になる。
//   sessionId 単位でキャッシュして run 内の全バッチで同一テキストを使う（＝第2ブロックが cache read 化）。
//   Railway は単一プロセス常駐のためプロセス内 Map で run 全バッチをカバーできる。
const RUN_CONTEXT_TTL_MS = 30 * 60 * 1000;
const runContextCache = new Map<string, { context: string; ts: number }>();

function getCachedRunContext(sessionId: string): string | null {
  const hit = runContextCache.get(sessionId);
  if (hit && Date.now() - hit.ts < RUN_CONTEXT_TTL_MS) return hit.context;
  return null;
}

function setCachedRunContext(sessionId: string, context: string): void {
  // 期限切れエントリを掃除してから保存（メモリリーク防止）。
  const now = Date.now();
  for (const [k, v] of runContextCache) {
    if (now - v.ts >= RUN_CONTEXT_TTL_MS) runContextCache.delete(k);
  }
  runContextCache.set(sessionId, { context, ts: now });
}

// T-163: 中間バッチの圧縮結果を run 内で保持するプロセス内キャッシュ。
// 従来は中間バッチの結果をチャット（advisor_chat_messages）へ書き込み、最終バッチが
// チャット履歴経由で読み戻して総合まとめを作っていた。チャット書き込みを廃止したため、
// 同じ内容（compressBatchResultForSummary 済みテキスト）をここに積んで最終バッチへ渡す。
// Railway は単一プロセス常駐のため run 内の全バッチをカバーできる（runContextCache と同方式）。
const runBatchResultsCache = new Map<string, { results: string[]; ts: number }>();

function appendRunBatchResult(sessionId: string, compressed: string): void {
  const now = Date.now();
  for (const [k, v] of runBatchResultsCache) {
    if (now - v.ts >= RUN_CONTEXT_TTL_MS) runBatchResultsCache.delete(k);
  }
  const entry = runBatchResultsCache.get(sessionId);
  if (entry && now - entry.ts < RUN_CONTEXT_TTL_MS) {
    entry.results.push(compressed);
    entry.ts = now;
  } else {
    runBatchResultsCache.set(sessionId, { results: [compressed], ts: now });
  }
}

function takeRunBatchResults(sessionId: string): string[] {
  const entry = runBatchResultsCache.get(sessionId);
  if (!entry || Date.now() - entry.ts >= RUN_CONTEXT_TTL_MS) return [];
  return entry.results;
}

function clearRunBatchResults(sessionId: string): void {
  runBatchResultsCache.delete(sessionId);
}

// T-163: 完了カード用に、最終バッチ出力から総合まとめセクションだけを取り出す。
// 見つからなければ空文字を返す（呼び出し側は件数のみのカードにする。AIは再度呼ばない）。
function extractOverallSummary(analysisText: string): string {
  const idx = analysisText.indexOf("【総合優先順位");
  if (idx === -1) return "";
  let from = analysisText.lastIndexOf("\n", Math.max(0, idx - 1));
  from = from === -1 ? 0 : from + 1; // 見出し行の行頭
  // 直前行が罫線（━…）ならそこから含める（見た目を揃える）
  if (from >= 2) {
    const prevStart = analysisText.lastIndexOf("\n", from - 2) + 1;
    const prevLine = analysisText.slice(prevStart, from - 1).trim();
    if (/^━+$/.test(prevLine)) from = prevStart;
  }
  return analysisText.slice(from).trim();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode");
  const body = await req.json();
  const { sessionId, batchIndex, batchSize, totalFiles, isLastBatch, sinceDate, dryRun } = body as {
    sessionId: string;
    batchIndex: number;
    batchSize: number;
    totalFiles: number;
    isLastBatch: boolean;
    sinceDate?: string;
    // T-182: 判定基準の精度検証用。true なら AI 評価だけ行い DB へ一切書き戻さない
    //（CandidateFile の評価上書き・完了カードのチャット書き込みを両方スキップ）。既定 false。
    dryRun?: boolean;
  };

  if (!sessionId || batchIndex == null || !batchSize || !totalFiles) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 1. Fetch bookmark files with extracted text (optionally filtered by date)
  //    extractedText の無い行は評価対象外。サイト経由（origin="candidate"/driveFileId=null）は
  //    PDF実体が無く抽出テキストも生成されないため、この条件で自動的に除外される（AI評価対象外）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = {
    candidateId,
    category: "BOOKMARK",
    extractedText: { not: null },
    archivedAt: null,
  };
  if (sinceDate) {
    whereClause.createdAt = { gt: new Date(sinceDate) };
  }

  const fetchedBookmarks = await prisma.candidateFile.findMany({
    where: whereClause,
    select: {
      id: true,
      fileName: true,
      extractedText: true,
      aiAnalysisComment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // invalid-only mode:
  //   - aiAnalysisComment が NULL/空 → 対象
  //   - 3軸マーカーが欠落している → 対象
  //   - それ以外（正常）は除外
  const allBookmarks = mode === "invalid-only"
    ? fetchedBookmarks.filter((f) => {
        if (!f.aiAnalysisComment || f.aiAnalysisComment.trim() === "") return true;
        if (!hasValidThreeAxisMarkers(f.aiAnalysisComment)) return true;
        if (!f.aiAnalysisComment.includes("◆")) return true;
        return false;
      })
    : fetchedBookmarks;

  // 2. Get batch slice
  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, allBookmarks.length);
  const batchFiles = allBookmarks.slice(start, end);

  if (batchFiles.length === 0) {
    return NextResponse.json({ error: "No files in this batch" }, { status: 400 });
  }

  // 3. Get candidate context.
  //    T-126 Phase2: run内は sessionId 単位でキャッシュし、全バッチで byte-identical にする
  //    （第2キャッシュブロックを read 化＋主要書類の再OCRを1回に削減）。
  //    context の組み立て（評価一覧の除去・20,000字切り詰め）は lib（buildAnalyzeCandidateContext）へ
  //    切り出し済み。runContextCache は CA 画面 run 制御のため route に残す。
  let candidateContext = getCachedRunContext(sessionId) ?? "";
  if (!candidateContext) {
    candidateContext = await buildAnalyzeCandidateContext(candidateId);
    // 空文字はキャッシュしない（次バッチで再取得を試みる）。
    if (candidateContext.trim() !== "") {
      setCachedRunContext(sessionId, candidateContext);
    }
  }

  // 4. Build job posting section for this batch (uses DB-stored extracted text - no PDF binary)
  //    組み立ては lib（buildAnalyzeJobsSection）へ切り出し済み。出力は切り出し前と同一。
  const jobsSection = buildAnalyzeJobsSection(batchFiles, start);

  // 5. Build system prompt
  //    固定プレフィックス（SKILL_HEADER+EVAL_RULES）とバッチ指示の組み立ては lib
  //    （src/lib/analyze-bookmarks.ts）へ切り出し済み。文言は切り出し前と byte 同一
  //    （自動評価経路と 1h プロンプトキャッシュを共有する条件でもある）。
  const FIXED_SYSTEM = buildAnalyzeFixedSystem();
  const systemPrompt = buildBatchInstruction({ totalFiles, start, end, isLastBatch });

  // 6. 過去バッチ結果 — 最終バッチ（総合まとめ生成）のみ同梱する。
  //    中間バッチは各求人単体分析に履歴不要のため非同梱（input 削減・質不変）。
  //    T-126 Phase2: 過去バッチ結果は compressBatchResultForSummary で会社名+3軸だけに圧縮し、
  //    uncached input を削減する（最終バッチの入力膨張=最高額コールの主因）。
  //    T-163: 供給元をチャット履歴（advisor_chat_messages）から run 内のプロセス内キャッシュへ変更。
  //    中間バッチのチャット書き込みを廃止したため（step 8 参照）。内容は従来と同じ圧縮形式。
  //    プロセス再起動等でキャッシュが空の場合は、各バッチが candidate_files に保存済みの
  //    aiAnalysisComment（会社名見出し+3軸+本文を含む）から同じ圧縮で再構成するフォールバック。
  let priorBatchResults: string[] = [];
  if (isLastBatch) {
    priorBatchResults = takeRunBatchResults(sessionId);
    if (priorBatchResults.length === 0 && start > 0) {
      priorBatchResults = allBookmarks
        .slice(0, start)
        .map((f) => (f.aiAnalysisComment ? compressBatchResultForSummary(f.aiAnalysisComment) : ""))
        .filter((t) => t.trim() !== "");
    }
  }

  const priorResultsText = priorBatchResults
    .map((t) =>
      t.length > MAX_CHAT_MESSAGE_CHARS
        ? t.substring(0, MAX_CHAT_MESSAGE_CHARS) + "\n...（省略）"
        : t
    )
    .join("\n\n---\n\n");

  const messagesArray = [
    // 過去バッチ結果を従来のチャット履歴と同じ位置（最終 user ターンの前）に assistant 発話として置く。
    // systemPrompt の「これまでのバッチの結果はチャット履歴に含まれています」の参照先はこのターン。
    ...(priorResultsText
      ? [
          {
            role: "user" as const,
            content: `これまでのバッチ（1〜${start}件目）の分析結果を出力してください。`,
          },
          { role: "assistant" as const, content: priorResultsText },
        ]
      : []),
    {
      // T-126 Phase2: 候補者情報は system の第2キャッシュブロックへ移動（run内不変=バッチ間で cache read 化）。
      // user ターンには可変部（このバッチの求人票）だけを置く。
      role: "user" as const,
      content: `## 検討中の求人票（${start + 1}〜${end}件目 / 全${totalFiles}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
    },
  ];

  // 7. Call Anthropic API
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  // system ブロックの並び順: ①固定プレフィックス(skill+評価ルール) → ②候補者context → ③可変(バッチ指示)。
  // T-189: 従来の isMultiBatch ガード（1バッチ run では cache_control を付けない）を撤廃し、
  //   全実行で①②にキャッシュを付ける。①は run をまたいで byte-identical なので 1h TTL。
  //   付与ポリシーの詳細は src/lib/analyze-batch-cache.ts のコメント参照。
  const systemBlocks = buildAnalyzeBatchSystemBlocks({
    fixedSystem: FIXED_SYSTEM,
    candidateContext,
    batchInstruction: systemPrompt,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL_ANALYSIS,
        max_tokens: 16000,
        temperature: 0.7,
        system: systemBlocks,
        messages: messagesArray,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[AnalyzeBatch] Anthropic error:", response.status, errText);
      // T-126: 失敗コールも記録（課金トークンは無いが失敗率の可視化に使う）。
      await recordAdvisorUsage({
        endpoint: "analyze-batch",
        model: CLAUDE_MODEL_ANALYSIS,
        usage: null,
        candidateId,
        batchIndex,
        batchTotal: Math.ceil(totalFiles / batchSize),
        fileCount: batchFiles.length,
        isRetry: mode === "invalid-only",
        note: `error-${response.status}`,
      });
      if (response.status === 429) {
        return NextResponse.json({ error: "APIのレート制限に達しました。少し待ってから再度お試しください。" }, { status: 429 });
      }
      let detail = "";
      try {
        const errJson = JSON.parse(errText);
        detail = errJson?.error?.message || "";
      } catch { /* not JSON */ }
      return NextResponse.json({
        error: `AIからの応答取得に失敗しました（${response.status}${detail ? `: ${detail}` : ""}）`,
      }, { status: 500 });
    }

    const data = await response.json();
    const u = data.usage ?? {};
    console.log(`[analyze-batch usage] input=${u.input_tokens} output=${u.output_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens}`);
    // T-126: usage を永続化。invalid-only は再実行経路なので isRetry=true。
    await recordAdvisorUsage({
      endpoint: "analyze-batch",
      model: CLAUDE_MODEL_ANALYSIS,
      usage: u,
      candidateId,
      batchIndex,
      batchTotal: Math.ceil(totalFiles / batchSize),
      fileCount: batchFiles.length,
      isRetry: mode === "invalid-only",
      note: isLastBatch ? "last-batch" : null,
    });
    const analysisText = data.content?.[0]?.text || "";

    // 8. T-163: 中間バッチはチャットへ書き込まない。
    //    従来はバッチごとに user/assistant 1組を advisor_chat_messages へ書き込んでいたが、
    //    分析長文がチャットの送信窓（直近20件）を占拠し input 肥大と few-shot 汚染を
    //    起こしていた（実測: 窓の84.7%が分析産物）。個別の評価は step 9 で
    //    CandidateFile.aiMatchRating / aiAnalysisComment に保存され一覧バッジから閲覧できる。
    //    中間バッチの結果は総合まとめ生成用にプロセス内キャッシュへ圧縮して積み、
    //    最終バッチ完了後に「完了カード」1組だけを書き込む（step 9 の後）。
    const label = isLastBatch
      ? `【求人分析 バッチ${batchIndex + 1}（${start + 1}〜${end}件目）+ 総合まとめ】`
      : `【求人分析 バッチ${batchIndex + 1}（${start + 1}〜${end}件目）】`;

    if (!isLastBatch) {
      appendRunBatchResult(sessionId, compressBatchResultForSummary(analysisText));
    }

    // 9. Extract ratings + comments and save to CandidateFile
    //    抽出と fail-closed 保存（3点セット揃い時のみ・T-182 dryRun 対応）は lib（applyAnalysisResults）へ
    //    切り出し済み。挙動・ログ・保存ロジックは切り出し前と同一。
    const { skippedFileIds } = await applyAnalysisResults({
      analysisText,
      batchFiles,
      candidateId,
      dryRun,
    });

    // T-163: 最終バッチ完了後、チャットへは「完了カード」1組のみを書き込む。
    //   - 件数はAIに数えさせず、DB保存済みの aiMatchRating をプログラムで集計する
    //     （このバッチの保存が終わった step 9 の後に再取得するため、run 全体の最新値になる）。
    //   - 総合まとめ本文は最終バッチのAI出力から抽出。失敗時は件数のみのカード（AIは再度呼ばない）。
    //   - カード作成の失敗で分析本体（評価保存・レスポンス）を落とさない。
    if (isLastBatch && !dryRun) {
      try {
        // T-165: 集計母集団は「今回の実行対象」に限定する。バッチは allBookmarks を先頭から
        // batchSize 刻みで順に切るため、最終バッチの end が run 全体でカバーした末尾
        // （= 実行対象は allBookmarks.slice(0, end)）。allBookmarks 全体を数えると、
        // 絞り込み（追加のみ / 未評価・破損のみ）で対象外だった過去評価分まで混入し、
        // 見出しの件数がまとめ本文の「全N件」と矛盾する。
        const runTargetFiles = allBookmarks.slice(0, end);
        const runFiles = await prisma.candidateFile.findMany({
          where: { id: { in: runTargetFiles.map((f) => f.id) } },
          select: { aiMatchRating: true },
        });
        // 幅表記（"A〜B"等）は先頭の評価値で読む。B+ を B と誤読しないよう RATING_VALUE（B\+ 先行の交替）を使う。
        const headRatingRe = new RegExp(`^(${RATING_VALUE})`);
        const counts: Record<string, number> = { A: 0, "B+": 0, B: 0, C: 0, D: 0 };
        let unrated = 0;
        for (const f of runFiles) {
          const m = (f.aiMatchRating ?? "").match(headRatingRe);
          if (m && m[1] in counts) counts[m[1]]++;
          else unrated++;
        }
        const header =
          `【求人分析 完了】${runFiles.length}件を評価しました\n` +
          `総合 A:${counts["A"]}件 / B+:${counts["B+"]}件 / B:${counts["B"]}件 / C:${counts["C"]}件 / D:${counts["D"]}件 / 未評価:${unrated}件`;
        const footer = `※ 各求人の評価コメントは、求人一覧の評価バッジをクリックすると開きます。`;
        // 本文全体を 2,000 字以内に収める（超過分は総合まとめ側を削り、件数と案内文は必ず残す）。
        const MAX_CARD_CHARS = 2000;
        let summary = extractOverallSummary(analysisText);
        const fixedLen = header.length + footer.length + 4; // 区切りの空行ぶん
        const OMIT_SUFFIX = "\n…（省略）";
        if (summary && fixedLen + summary.length > MAX_CARD_CHARS) {
          summary =
            summary.substring(0, Math.max(0, MAX_CARD_CHARS - fixedLen - OMIT_SUFFIX.length)) +
            OMIT_SUFFIX;
        }
        const cardContent = summary ? `${header}\n\n${summary}\n\n${footer}` : `${header}\n\n${footer}`;

        await prisma.advisorChatMessage.create({
          data: {
            sessionId,
            role: "user",
            content: `ブックマーク求人分析（全${totalFiles}件）を実行`,
            kind: "ANALYSIS",
          },
        });
        await prisma.advisorChatMessage.create({
          data: { sessionId, role: "assistant", content: cardContent, kind: "ANALYSIS" },
        });
      } catch (cardErr) {
        console.error("[AnalyzeBatch] completion card create failed (non-fatal):", cardErr);
      } finally {
        clearRunBatchResults(sessionId);
      }
    }

    return NextResponse.json({
      batchIndex,
      startIndex: start + 1,
      endIndex: end,
      totalFiles: allBookmarks.length,
      isLastBatch: end >= allBookmarks.length,
      analysisText: `${label}\n\n${analysisText}`,
      remainingFiles: allBookmarks.length - end,
      skippedFileIds,
    });
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      console.error("[AnalyzeBatch] Timeout after", API_TIMEOUT_MS, "ms");
      return NextResponse.json({ error: "タイムアウトしました" }, { status: 504 });
    }
    console.error("[AnalyzeBatch] Error:", e);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}

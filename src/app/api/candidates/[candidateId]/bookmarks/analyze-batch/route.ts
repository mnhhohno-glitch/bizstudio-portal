import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getCandidateContext, RATINGS_SECTION_MARKER } from "@/lib/advisor-context";
import { getJobMatchingSkill } from "@/lib/load-job-matching-skill";
import { CLAUDE_MODEL_ANALYSIS } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { RATING_VALUE } from "@/lib/ai-rating";
import { CA_MARK_CLASS, matchCaItemLine } from "@/lib/ca-analysis-format";
import { extractCompanyNameCandidates } from "@/lib/normalize-filename";
import { buildAnalyzeBatchSystemBlocks } from "@/lib/analyze-batch-cache";

export const maxDuration = 300; // 5 minutes

// T-180: 選考分析（CA向け）の項目見出し行「【固定残業】▲」を、求人セクション見出し
// 「【会社名】求人タイトル」と区別するための否定先読み。
// 【…】の直後が「判定記号1文字だけで行末」なら項目行なのでセクション区切りとして扱わない。
const NOT_CA_ITEM = `(?!\\s*${CA_MARK_CLASS}\\s*(?:\\n|$))`;

function hasValidThreeAxisMarkers(comment: string | null | undefined): boolean {
  if (!comment) return false;
  const c = comment.replace(/\*\*/g, "");
  const hasDesire = new RegExp(`■\\s*本人希望[：:]\\s*${RATING_VALUE}`).test(c);
  const hasPass = new RegExp(`(?:■\\s*)?通過率[：:]\\s*${RATING_VALUE}`).test(c);
  const hasOverall = new RegExp(`(?:■\\s*)?総合[：:]\\s*${RATING_VALUE}`).test(c);
  return hasDesire && hasPass && hasOverall;
}

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

function extractRatingsAndComments(
  analysisText: string,
  batchFiles: { id: string; fileName: string }[]
): Map<string, { rating: string; comment: string }> {
  const results = new Map<string, { rating: string; comment: string }>();

  // === Phase 1: Extract ratings from summary section ===
  const summaryMatch = analysisText.match(/【総合優先順位[^】]*】([\s\S]*?)(?:$|\n\n\n)/);
  const summarySection = summaryMatch ? summaryMatch[1] : "";

  if (summarySection) {
    const summaryRatings = new Map<string, string>();
    let currentRating = "";

    for (const line of summarySection.split("\n")) {
      const trimmed = line.trim();
      if (new RegExp(`^${RATING_VALUE}$`).test(trimmed)) { currentRating = trimmed; continue; }
      if (trimmed === "該当なし" || trimmed === "") continue;
      if (trimmed.startsWith("*")) {
        const cn = trimmed.replace(/^\*\s*/, "").trim();
        if (cn && cn !== "該当なし" && currentRating) summaryRatings.set(cn, currentRating);
        continue;
      }
      if (currentRating && trimmed.length > 1 && !trimmed.startsWith("【")) {
        summaryRatings.set(trimmed, currentRating);
      }
    }

    for (const file of batchFiles) {
      if (results.has(file.id)) continue;
      const searchNames = extractSearchNames(file.fileName);
      for (const [summaryCompany, rating] of summaryRatings) {
        for (const name of searchNames) {
          if (
            summaryCompany.includes(name) ||
            name.includes(summaryCompany) ||
            normalizeCompanyName(summaryCompany) === normalizeCompanyName(name)
          ) {
            results.set(file.id, { rating, comment: "" });
            break;
          }
        }
        if (results.has(file.id)) break;
      }
    }
  }

  // === Phase 2: Extract individual section comments + fallback ratings ===
  // Use space-normalized text for matching (length-preserving, so indices map to original)
  const normalizedText = normalizeSpaces(analysisText);

  for (const file of batchFiles) {
    const searchNames = extractSearchNames(file.fileName);

    for (const name of searchNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Try multiple section header patterns:
      // 1. Current AI format: ## 【会社名】 / ### 【会社名】 / **【会社名】**
      // 2. Legacy: 【会社名】 (bare)
      // 3. Legacy: 求人N: ファイル名
      const sectionPatterns = [
        // 行頭アンカー + Markdown見出し/太字装飾許容
        new RegExp(`(?:^|\\n)(?:#{1,3}\\s*)?(?:\\*\\*\\s*)?【[^】]*${escaped}[^】]*】`, "i"),
        // 素の【...】マッチ（行中含む）
        new RegExp(`【[^】]*${escaped}[^】]*】`, "i"),
        // 旧フォーマット
        new RegExp(`(?:###?\\s*)?求人\\d+[：:]\\s*[^\\n]*${escaped}`, "i"),
      ];

      let startIndex = -1;
      for (const pattern of sectionPatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
          const matchedText = match[0];
          const rawIndex = normalizedText.indexOf(matchedText);
          if (rawIndex !== -1) {
            // 先頭の \n や ## や ** 分を除外して 【 の位置にずらす
            const braceOffset = matchedText.indexOf("【");
            startIndex = braceOffset >= 0 ? rawIndex + braceOffset : rawIndex;
            break;
          }
        }
      }

      // Also try direct name search as fallback
      if (startIndex === -1) {
        startIndex = normalizedText.indexOf(name);
        if (startIndex !== -1) {
          // Walk back to find section start (--- or line start)
          const before = analysisText.substring(Math.max(0, startIndex - 200), startIndex);
          const lastSep = before.lastIndexOf("---");
          if (lastSep !== -1) {
            startIndex = startIndex - 200 + lastSep + before.length - before.lastIndexOf("---");
            startIndex = Math.max(0, startIndex - 200) + lastSep + 3;
          }
        }
      }

      if (startIndex === -1) continue;

      // セクション終端: 次の会社セクション（## 【】 / **【】 / 空行後の裸【】）・総合まとめ・旧求人N:
      // ※ \n--- は求人内部の区切りにも使われるため終端に含めない（推薦本文まで取り込む）
      // ※ T-180: 選考分析（CA向け）の項目見出し「【固定残業】▲」も空行後の裸【】に見えるため、
      //   NOT_CA_ITEM（記号1文字で行末＝項目行 を否定先読みで除外）を付けないと、
      //   1件目の項目行で求人セクションが打ち切られ選考分析が丸ごと欠落する。
      const afterStart = analysisText.substring(startIndex);
      const nextSection = afterStart
        .slice(1)
        .match(new RegExp(
          `\\n##\\s+【[^】]+】${NOT_CA_ITEM}|\\n\\*\\*\\s*【[^】]+】|\\n\\n【[^】]+】${NOT_CA_ITEM}|\\n(?:###?\\s*)?求人\\d+[：:]|\\n━━━`
        ));
      const endIndex = nextSection
        ? startIndex + 1 + (nextSection.index || afterStart.length)
        : startIndex + Math.min(afterStart.length, 3000);

      const comment = analysisText.substring(startIndex, endIndex).trim();

      if (comment.length > 10) {
        const existing = results.get(file.id);
        if (existing) {
          existing.comment = comment;
        } else {
          const ratingMatch = comment.match(new RegExp(`■\\s*総合[：:]\\s*(${RATING_VALUE})`))
            || comment.match(new RegExp(`総合[：:]\\s*(${RATING_VALUE})`));
          results.set(file.id, { rating: ratingMatch ? ratingMatch[1] : "", comment });
        }
        break;
      }
    }

    // Fallback: rating from nearby text if still no rating
    const entry = results.get(file.id);
    if (entry && !entry.rating) {
      for (const name of searchNames) {
        const idx = normalizedText.indexOf(name);
        if (idx === -1) continue;
        const area = analysisText.substring(Math.max(0, idx - 100), Math.min(analysisText.length, idx + 600));
        const patterns = [
          new RegExp(`■\\s*総合[：:]\\s*(${RATING_VALUE})`),
          new RegExp(`総合[：:]\\s*(${RATING_VALUE})`),
          new RegExp(`評価[：:]\\s*(${RATING_VALUE})`),
          new RegExp(`【(${RATING_VALUE})】`),
        ];
        for (const p of patterns) {
          const m = area.match(p);
          if (m) { entry.rating = m[1]; break; }
        }
        if (entry.rating) break;
      }
    }

    // Fallback: Phase 2 が失敗した場合は「rating だけ保存/comment NULL」を
    // 量産しないよう、results には追加せずスキップする（警告ログのみ）。
    if (!results.has(file.id)) {
      console.warn(
        `[AnalyzeBatch] Phase2 failed to extract section, skipping partial save: fileId=${file.id}, fileName="${file.fileName}", searchNames=${JSON.stringify(searchNames)}`
      );
    }
  }

  return results;
}

function extractSearchNames(fileName: string): string[] {
  const names: string[] = [];
  let name = fileName.replace(/\.pdf$/i, "");

  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/);
  if (p1) names.push(p1[1]);

  const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/);
  if (p2) names.push(p2[1]);

  const p3 = name.match(/^(.+?)_No\d+$/i);
  if (p3) names.push(p3[1]);

  const pBee = name.match(/^(.+?)[：:]\d+$/);
  if (pBee && pBee[1]) names.push(pBee[1].trim());

  const p4 = name.match(/^求人票[_]?(.+)$/);
  if (p4 && !names.includes(p4[1])) names.push(p4[1]);

  if (names.length === 0) names.push(name);

  // Normalize full-width spaces to half-width in all names
  for (let i = 0; i < names.length; i++) {
    names[i] = normalizeSpaces(names[i]);
  }

  const expanded: string[] = [...names];
  for (const n of names) {
    const stripped = n
      .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
      .trim();
    if (stripped.length >= 2 && !expanded.includes(stripped)) {
      expanded.push(stripped);
    }
    // Fullwidth → halfwidth version
    const normalized = n
      .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    if (normalized !== n && !expanded.includes(normalized)) {
      expanded.push(normalized);
    }
  }

  // T-146 追加調査: ファイル名に会社名以外の文字（括弧書き・部署名・キャッチコピー・
  // 記号）が混ざると、上のどの候補にも不純物が残り 【会社名】 と照合できずに
  // 評価の保存ごとスキップされる（本番で 105 件・求職者 52 名）。
  // ★必ず末尾に追加する★ — 候補は先頭から順に試され最初の一致で確定するため、
  // 末尾に足す限り現在成功している照合の挙動は変わらない。
  for (const core of extractCompanyNameCandidates(fileName)) {
    if (!expanded.includes(core)) expanded.push(core);
  }

  return expanded;
}

/**
 * 照合用アポストロフィの畳み込み（1文字→1文字・長さ保存）。
 *
 * AI は入力の `’`(U+2019) を `'`(U+0027) に正規化して見出しを書くことがあり、
 * ファイル名側（DB実値）が U+2019 のままだと `【[^】]*会社名[^】]*】` の照合が
 * 必ず MISS して評価の保存ごとスキップされる（本番で 6件・求職者6名が該当）。
 *   例) DB: 求人票_株式会社ＣＯＭ’Ｓ.pdf  ／ AI出力: 【株式会社ＣＯＭ'Ｓ】
 *
 * ★対象は U+2019 / U+FF07 / U+2018 / U+02BC の4種のみ★
 * `` ` ``(U+0060) と `´`(U+00B4) は会社名の区切りとして使われうるため畳まない。
 */
const APOSTROPHE_VARIANTS = /[’＇‘ʼ]/g;

/**
 * Replace full-width spaces with half-width, and unify apostrophe variants,
 * for matching. ★必ず長さ保存（1文字→1文字）であること★
 * normalizedText のインデックスは analysisText にそのまま対応する前提で
 * 本文を substring 切り出ししているため（Phase 2 冒頭のコメント参照）、
 * ここに長さの変わる置換を足すと切り出しが破損する。
 */
function normalizeSpaces(str: string): string {
  return str.replace(/　/g, " ").replace(APOSTROPHE_VARIANTS, "'");
}

function normalizeCompanyName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(/[・]/g, "")
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
}

const API_TIMEOUT_MS = 300000;
const MAX_CONTEXT_CHARS = 20000;
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
  let candidateContext = getCachedRunContext(sessionId) ?? "";
  if (!candidateContext) {
    try {
      candidateContext = await getCandidateContext(candidateId);
      // Strip bookmark sections (we send job postings separately)
      // T-163: 評価一覧（RATINGS_SECTION_MARKER）はチャット用のため、評価する側の
      // analyze-batch には見せない（自分の過去評価による判定の自己調整を防ぐ）。
      // 評価一覧 → 求人票テキストの順で並ぶため、早い方の位置から除去する
      // ＝analyze-batch の入力は T-163 以前と byte 同一に保たれる。
      const ratingsIdx = candidateContext.indexOf(RATINGS_SECTION_MARKER);
      const bookmarkIdx = candidateContext.indexOf("## ブックマーク求人票");
      const cutIdx = [ratingsIdx, bookmarkIdx].filter((i) => i !== -1).sort((a, b) => a - b)[0];
      if (cutIdx !== undefined) {
        candidateContext = candidateContext.substring(0, cutIdx).trim();
      }
    } catch (e) {
      console.error("[AnalyzeBatch] Context error:", e);
    }

    // Truncate context to prevent oversized payloads
    if (candidateContext.length > MAX_CONTEXT_CHARS) {
      candidateContext = candidateContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
    }

    // 空文字はキャッシュしない（次バッチで再取得を試みる）。
    if (candidateContext.trim() !== "") {
      setCachedRunContext(sessionId, candidateContext);
    }
  }

  // 4. Build job posting section for this batch (uses DB-stored extracted text - no PDF binary)
  const jobsSection = batchFiles
    .map((f, i) => {
      const globalIndex = start + i + 1;
      const fullText = f.extractedText || "";
      const text = fullText.substring(0, 3000);
      console.log(`[AnalyzeBatch] Using extracted text: ${f.fileName} (${fullText.length} chars, sent ${text.length})`);
      return `### 求人${globalIndex}: ${f.fileName}\n${text}`;
    })
    .join("\n\n---\n\n");

  // 5. Build system prompt
  let systemPrompt: string;

  const EVAL_RULES = `## 評価ルール

各求人について、以下の3軸で評価を行うこと。**本人希望と通過率は A/B/C/D の4段階、総合は A/B+/B/C/D の5段階**（良い順に A > B+ > B > C > D。B+ は総合にのみ存在し、本人希望・通過率には使用しない）。評価基準は上記の「求人マッチングスキル定義」（特に Phase 5: ABCDマッチング評価）に従う。

### ① 本人希望（求職者の希望・志向性とのマッチ度）
- A: 志向性も条件もほぼ一致。本人が間違いなく応募する求人
- B: 方向性は合っているが、条件が何か足りない
- C: 条件は適しているが、方向性が合っていない
- D: 両方適していない

### ② 通過率（書類選考・面接の通過可能性）

**最初に必ず確認：** 必須要件（学歴・資格・経験年数）の充足チェック。未充足ならD判定（推薦状でカバー可能な場合のみC検討）。スキル定義の Phase 5 軸2 を参照。

**判定手順（2026年8月改訂・必ずこの順で）:**

1. 必須要件（学歴・資格・経験年数）の充足を確認する。未充足なら D で確定（推薦状でカバー可能な場合のみ C）
2. 必須要件を満たす場合、選考分析の各項目（年齢レンジ・経験年数・経験の質・転職回数・年収レンジ・勤務条件・歓迎要件など）に 〇/▲/× を付ける
3. **（選考観点の）▲と×の個数でランクを機械的に決める**。「迷ったらB」は禁止。懸念を数えて必ず A/B/C のどれかに振り分ける

| ランク | 判定条件 |
|---|---|
| A | 必須要件を全て満たし、選考観点の▲・×が0個。年齢・経験年数・転職回数が求人の想定レンジ内 |
| B | 必須要件を満たすが、選考観点の▲が1〜2個ある。×は0個 |
| C | 必須要件は満たすが、選考観点の▲が3個以上、または(必須要件以外に)×が1個以上ある。または必須要件未充足だが推薦状でカバー可能性あり |
| D | 必須要件の充足が不十分（学歴・資格・経験年数のいずれかが未充足） |

**歓迎要件の扱い:** 求人票に歓迎要件の記載があり、本人がそのいずれにも該当しない場合は、選考観点の▲1個として数える(選考分析に【歓迎要件】▲ の項目を立てる)。一部でも該当していれば〇。求人票に歓迎要件の記載がない場合は項目を立てず、数えない。
（閾値の根拠: 実績200件の検証 2026-08-28 T-182 step3 — 選考観点▲0個57.9%/1個61.2%/2個54.2%に対し▲3個以上27.8%・×1個以上36.5%。段差は▲2↔3の間と×の有無にのみある）

**A判定の条件について:** 過去の通過実績・企業の採用温度感は、判定時に分かっている場合のみ「B→A」「A→B」の補正に使う。Aの必須条件ではない。
この補正が使えるのは **A と B の間だけ** である。▲が3個以上ある／×がある求人（＝C）を「経験の親和性が高い」「致命的ではない」等の理由でBへ引き上げてはならない。個数ルールが常に優先する。


**数える対象（重要）:** 通過率に数えるのは「**企業が選考で落とす理由になる** ▲・×」だけである。
- **数える（選考観点）**: 必須要件充足 / 経験・スキル / 経験の質 / 経験年数 / 年齢レンジ / 転職回数 / 求人の想定年収レンジからの逸脱 / 歓迎要件 / 選考難易度
- **数えない（本人希望観点）**: 固定残業が希望より長い / 年間休日が希望より少ない / 通勤距離・勤務地が希望と違う / 職種の好みに合わない / 希望年収に届かない

本人希望観点の懸念は「① 本人希望」で既に評価しているため、通過率に二重計上してはならない（2軸が同じものを測ってしまい、通過率の予測力が失われる）。ただし勤務地・勤務条件でも「物理的に通勤不可能」「シフトが本人の制約と両立不可」など**選考自体が成立しない**水準であれば選考観点として数える。
**判定の甘さの目安:** ランク付き求人のうち通過率Bが5割を超えている状態は、懸念を数えずにBへ逃げている可能性が高い。

**【出力順に関する必須手順】** 「■ 通過率」行は出力上は「◆ 選考分析（CA向け）」より前に来るが、**判定の順序は逆である**。1件の求人を書き始める前に、必ず先に選考分析の全項目（〇の項目も含む）と各項目の 〇/▲/× を内部で確定させ、そのうち**選考観点の** ▲ と × の個数を数えてから通過率ランクを決め、「■ 通過率」行を書くこと。ランクを先に決めてから ▲・× を後付けで合わせてはならない。出力し終えた時点で、「◆ 選考分析（CA向け）」に出力した選考観点の ▲・× の行数と上表の条件が必ず一致していること（不一致は誤りであり、その場合は ▲・× の行を正として通過率ランクを直す）。

補足:
- 業務委託・BPO・派遣での経験は、自社運営の経験より書類評価が低くなる傾向
- 35歳以上で未経験業種への応募は書類通過率が大幅に下がる（詳細は付録「ミドル層詳細ガイド」参照）
- 固定残業時間が長い求人（30時間超）は安定志向の求職者にはマイナス評価

### ③ 総合（紹介推奨度）
- A: 積極的に紹介 — 本人希望にも合い、通過も見込める
- B+: 紹介する価値は明確にあるが最優先ではない — 本人希望と通過率のどちらか一方がA、もう一方がB
- B: 紹介してよい — バランスが取れている、または片方が強い
- C: 条件付きで検討 — 紹介するなら補足説明や対策が必要
- D: 紹介非推奨 — 本人にも合わず通過も厳しい

判断材料: ①②を機械的に合成する。**必ずスキル定義 Phase 5「総合評価の算出」テーブルに従うこと。**

| 希望 × 通過 | 総合評価 |
|---|---|
| A × A | 総合A |
| A × B | 総合B+ |
| B × A | 総合B+ |
| A × C〜D | 総合B |
| B × B | 総合B |
| B × C | 総合C |
| B × D | 総合C |
| C × A〜B | 総合C |
| C × C | 総合C |
| C × D | 総合D |
| D × 任意 | 総合D |

**本表は希望×通過の全組み合わせを網羅する。表にない組み合わせは存在しないため、AIが独自に判断してはならない。**

総合評価は「本人の希望に合っているか」を優先して決める。希望に合わない求人は、選考を通過しやすくても本人が応募しないため、良い評価を付けても紹介に結びつかない。したがって希望Aは通過が厳しくてもBを維持し、希望Cは通過が堅くてもCに留める。必須要件未充足（通過率D）の求人が総合A・総合B+ になることはない。

**評価は必ず1つに確定させること。** 総合は A / B+ / B / C / D のいずれか1つ、本人希望と通過率は A / B / C / D のいずれか1つを返す。「A〜B」「B〜C」のような範囲表記、「Bより」「B寄り」「Bに近いC」等の曖昧表現は使用しない。迷った場合も必ず1つに決める。

## 出力フォーマット
各求人の分析コメントは以下のフォーマットで、簡潔に出力してください。求人と求人の間には必ず空行を2行入れて区切ること：

---

【会社名】求人タイトル

■ 本人希望: A / B / C / D のいずれか1つ
■ 通過率: A / B / C / D のいずれか1つ
■ 総合: A / B+ / B / C / D のいずれか1つ

※この3行には評価記号のみを書く。「A〜B」等の範囲表記や補足語を付けないこと。

◆ おすすめポイント（本人向け）
（総評。2〜3行・合計120字以内）

◆ 選考分析（CA向け）
▲ 懸念の内容
× 不適合の内容

## 書式の絶対ルール（T-189 出力短縮）
- 前置き（「以下に分析します」「こちらの求人は」等）・締めの挨拶・次の行動の提案は一切書かない
- 求人票本文の要約・転記をしない。判定に使った事実は▲・×の行に一言で書く
- 同じ内容を別のセクションで繰り返さない
- 各求人のコメント内では「【会社名】求人タイトル」の見出し行以外に【】で始まる行を作らない

## ◆ おすすめポイント（本人向け）の書き方
マイページに表示され、本人が読む。**2〜3行・合計120字以内**の総評とし、評価ランク（A/B+/B/C/D）に関係なく前向きに書く（ランクの違いを文体に反映させない。ネガティブ要素・選考リスクはCA向けに集約されており、本人向けに書くと求職者のモチベーション低下や辞退に繋がるため）。
- 本人の経験・スキルと求人の接点、または求人の魅力を具体的に1点以上入れる（例:「○○さんの△△の経験は□□業務で活かせます」）
- 求職者名は「○○さん」で統一する。「あなた」は使わない
- 懸念点・確認事項・ネガティブな選考情報は書かない。「希望と異なる」「方向性が違う」「軽めにおすすめ」のようなネガティブ表現も使わない
- 禁止表現（PDF記載の希望情報は面談で変化していることが多いため）: 「第1希望」「第2希望」のような順位特定表現／PDF記載の具体的希望職種名の引用／「ご希望の職種「XX」と完全一致」のような断定的マッチング表現。「本人の希望に合致する」ではなく「求人の魅力」「本人の経験との接点」を主体に書く

## ◆ 選考分析（CA向け）の書き方
マイページには表示されず、CAのみが閲覧する。キャリアアドバイザーが選考を進める上で把握すべき現実的な評価を、**▲・×に該当する指摘のみ1項目1行**で書く：
- 各行は「▲ 」または「× 」で始め、記号に続く本文は40字以内。「何が」「どの程度」を事実ベースで端的に書く（例: ▲ 固定残業45h。本人希望11〜15hと乖離）
- 記号の意味は従来どおり（▲=懸念あり・要確認・条件が一部合わない、×=不適合・選考上の大きな障害）。〇（問題なし）の項目は内部判定のみ行い、出力しない
- ▲・×に該当する項目が1つも無い場合は「懸念なし」と1行だけ書く
- 行頭記号は ▲ / × の2種のみ。◎ △ ー 等の他の記号や記号なしの指摘行は不可
- 本人希望観点の懸念（固定残業・年間休日・通勤距離・職種の好み・希望年収との差）も▲・×に該当すれば行として書く。ただし通過率ランクに数えるのは**選考観点の▲・×**（必須要件・経験・スキル・年齢・転職回数・想定年収レンジ逸脱・歓迎要件・選考難易度）のみ（評価ルール②参照）
- 必須要件未充足（通過率D）の場合は、その未充足内容を必ず×の行として書く
- 推薦時の注意点・選考対策が特に必要な場合のみ、▲の行として1行で書いてよい
- **出力した選考観点の▲・×の行数が「■ 通過率」ランクの根拠である**（評価ルール②の表と必ず一致させること）

【重要ルール】
- 必ず「◆ おすすめポイント（本人向け）」→「◆ 選考分析（CA向け）」の順で両セクションを出力すること。どちらか片方だけでは不可
- 「---」の区切り線で各求人を明確に分離すること

## 重要
- 候補者の経歴情報が不足している場合は、正確な判定はできない旨を明記してください
- 情報が不足している場合でも、求人票の内容は分析し、「候補者情報が不足しているため、求人内容のみの評価です」と前置きしてください
- 推測や仮定で候補者のスキルや経験を補完しないでください`;

  const skillContent = getJobMatchingSkill();
  const SKILL_HEADER = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。
以下の「求人マッチングスキル定義」に基づき、候補者情報と求人票を分析してください。

---

# 求人マッチングスキル定義

${skillContent}

---

`;

  // キャッシュ最適化: 固定部分(skill+評価ルール)を独立ブロック化し cache_control を付与する。
  // 可変部分(バッチ指示)は別ブロックに分離（cache_control なし）。テキスト内容は不変。
  const FIXED_SYSTEM = `${SKILL_HEADER}${EVAL_RULES}`;

  if (isLastBatch) {
    systemPrompt = `# このリクエストの分析タスク

これは全${totalFiles}件中の最後のバッチ（${start + 1}〜${end}件目）です。

## このバッチの分析後、以下の総合まとめを必ず出力すること

最後に以下の形式で総合まとめを出力してください。
ランクごとにセクションを分け、各社は1行ずつ記載し、ランク間には空行を入れること（見出し・罫線を除き**全体で300字以内**。個別コメントの内容は繰り返さない）：

━━━━━━━━━━━━━━━━━━━
【総合優先順位（全${totalFiles}件）】
━━━━━━━━━━━━━━━━━━━

■ 総合A（積極的に紹介）

・会社名

■ 総合B+（紹介する価値は明確だが最優先ではない）

・会社名

■ 総合B（紹介してよい）

・会社名

■ 総合C（条件付きで検討）

・会社名

■ 総合D（紹介非推奨）

・会社名

- ランクの並び順は 総合A → 総合B+ → 総合B → 総合C → 総合D とし、5ランクすべてのヘッダーを出力すること
- 各ランクのヘッダー（■ 総合A 等）の前後に必ず空行を入れること
- 各社は「・」で始め、1社1行・会社名のみを記載すること（評価の内訳や説明文は書かない）
- 該当なしのランクは「該当なし」と記載すること

※これまでのバッチの結果はチャット履歴に含まれています。それを参照して総合まとめを作成してください。`;
  } else {
    systemPrompt = `# このリクエストの分析タスク

これは全${totalFiles}件中の${start + 1}〜${end}件目です。

- このバッチの分析のみ行い、総合まとめは最終バッチで行います
- 「---」の区切り線で各求人を明確に分離すること`;
  }

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
        // T-189: 出力書式の短縮（▲×1行化・総評120字）に伴い 16000 → 6000。
        // 1バッチ最大5件 × 新書式（3軸+総評+▲×行）で 6000 tok は十分な上限。
        max_tokens: 6000,
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
    //    「rating + comment + 3軸マーカー」の3点が揃って初めて DB 反映する。
    //    部分保存（rating だけ / 3軸欠落）は一切行わず、skippedFileIds として返す。
    const ratingsAndComments = extractRatingsAndComments(analysisText, batchFiles);
    const skippedFileIds: string[] = [];
    // batchFiles にあって extraction 結果に載らなかったものも skip として報告
    const extractedIds = new Set(ratingsAndComments.keys());
    for (const f of batchFiles) {
      if (!extractedIds.has(f.id)) skippedFileIds.push(f.id);
    }

    for (const [fileId, { rating, comment }] of ratingsAndComments) {
      try {
        if (!rating || !comment) {
          skippedFileIds.push(fileId);
          console.warn(
            `[AnalyzeBatch] Incomplete data, skipping update: fileId=${fileId} hasRating=${!!rating} hasComment=${!!comment}`
          );
          continue;
        }
        if (!hasValidThreeAxisMarkers(comment)) {
          skippedFileIds.push(fileId);
          console.warn(
            `[AnalyzeBatch] 3軸マーカー欠落により上書きスキップ: fileId=${fileId}, candidateId=${candidateId}, head="${comment.substring(0, 100).replace(/\n/g, " ")}"`
          );
          continue;
        }
        // T-182 dryRun: 精度検証時は評価を DB へ書き戻さない
        //（レスポンスの analysisText だけ返し、既存の評価値は温存する）。
        if (!dryRun) {
          await prisma.candidateFile.update({
            where: { id: fileId },
            data: {
              aiAnalyzedAt: new Date(),
              aiMatchRating: rating,
              aiAnalysisComment: comment,
            },
          });
        }
      } catch (updateErr) {
        skippedFileIds.push(fileId);
        console.error(`[AnalyzeBatch] Update failed for fileId=${fileId}:`, updateErr);
      }
    }

    console.log("[AnalyzeBatch] Extracted ratings:", {
      totalFiles: batchFiles.length,
      extractedCount: ratingsAndComments.size,
      skippedCount: skippedFileIds.length,
      ratings: Object.fromEntries([...ratingsAndComments].map(([id, { rating }]) => [id, rating])),
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
      // T-189: dryRun 検証用に usage と抽出結果（fileId → rating/comment）を返す。
      // DB へは一切書かない dryRun 経路でのみ付与（通常経路のレスポンス形は不変）。
      ...(dryRun
        ? {
            usage: u,
            extracted: Object.fromEntries(
              [...ratingsAndComments].map(([id, v]) => [id, { rating: v.rating, comment: v.comment }])
            ),
          }
        : {}),
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

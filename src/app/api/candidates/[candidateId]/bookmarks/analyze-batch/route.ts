import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getCandidateContext } from "@/lib/advisor-context";

export const maxDuration = 300; // 5 minutes

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
      if (/^[ABCD]$/.test(trimmed)) { currentRating = trimmed; continue; }
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
  for (const file of batchFiles) {
    const searchNames = extractSearchNames(file.fileName);

    for (const name of searchNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Try multiple section header patterns:
      // 1. New format: 【会社名】求人タイトル
      // 2. Old format: 求人N: ファイル名
      // 3. ### 求人N: ファイル名
      const sectionPatterns = [
        new RegExp(`【[^】]*${escaped}[^】]*】`, "i"),
        new RegExp(`(?:###?\\s*)?求人\\d+[：:]\\s*[^\\n]*${escaped}`, "i"),
      ];

      let startIndex = -1;
      for (const pattern of sectionPatterns) {
        const match = analysisText.match(pattern);
        if (match) {
          startIndex = analysisText.indexOf(match[0]);
          if (startIndex !== -1) break;
        }
      }

      // Also try direct name search as fallback
      if (startIndex === -1) {
        startIndex = analysisText.indexOf(name);
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

      // Find section end: next --- separator, next 【company】, next 求人N:, or summary section
      const afterStart = analysisText.substring(startIndex);
      const nextSection = afterStart.slice(1).match(/\n---|\n【[^】]+】|\n(?:###?\s*)?求人\d+[：:]|\n━━━|\n\n【総合/);
      const endIndex = nextSection
        ? startIndex + 1 + (nextSection.index || afterStart.length)
        : startIndex + Math.min(afterStart.length, 1000);

      const comment = analysisText.substring(startIndex, endIndex).trim();

      if (comment.length > 10) {
        const existing = results.get(file.id);
        if (existing) {
          existing.comment = comment;
        } else {
          const ratingMatch = comment.match(/■\s*総合[：:]\s*([ABCD])/) || comment.match(/総合[：:]\s*([ABCD])/);
          results.set(file.id, { rating: ratingMatch ? ratingMatch[1] : "", comment });
        }
        break;
      }
    }

    // Fallback: rating from nearby text if still no rating
    const entry = results.get(file.id);
    if (entry && !entry.rating) {
      for (const name of searchNames) {
        const idx = analysisText.indexOf(name);
        if (idx === -1) continue;
        const area = analysisText.substring(Math.max(0, idx - 100), Math.min(analysisText.length, idx + 600));
        const patterns = [/■\s*総合[：:]\s*([ABCD])/, /総合[：:]\s*([ABCD])/, /評価[：:]\s*([ABCD])/, /【([ABCD])】/];
        for (const p of patterns) {
          const m = area.match(p);
          if (m) { entry.rating = m[1]; break; }
        }
        if (entry.rating) break;
      }
    }

    // Fallback: if no results at all, try simple text search for rating
    if (!results.has(file.id)) {
      for (const name of searchNames) {
        const idx = analysisText.indexOf(name);
        if (idx === -1) continue;
        const area = analysisText.substring(Math.max(0, idx - 100), Math.min(analysisText.length, idx + 600));
        const patterns = [/■\s*総合[：:]\s*([ABCD])/, /総合[：:]\s*([ABCD])/, /評価[：:]\s*([ABCD])/, /【([ABCD])】/];
        for (const p of patterns) {
          const m = area.match(p);
          if (m) { results.set(file.id, { rating: m[1], comment: "" }); break; }
        }
        if (results.has(file.id)) break;
      }
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

  const p4 = name.match(/^求人票[_]?(.+)$/);
  if (p4 && !names.includes(p4[1])) names.push(p4[1]);

  if (names.length === 0) names.push(name);

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
  return expanded;
}

function normalizeCompanyName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[・]/g, "")
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
}

const API_TIMEOUT_MS = 120000;
const MAX_PAST_MESSAGES = 30;
const MAX_CONTEXT_CHARS = 20000;
const MAX_CHAT_MESSAGE_CHARS = 4000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { sessionId, batchIndex, batchSize, totalFiles, isLastBatch, sinceDate } = body as {
    sessionId: string;
    batchIndex: number;
    batchSize: number;
    totalFiles: number;
    isLastBatch: boolean;
    sinceDate?: string;
  };

  if (!sessionId || batchIndex == null || !batchSize || !totalFiles) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 1. Fetch bookmark files with extracted text (optionally filtered by date)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = {
    candidateId,
    category: "BOOKMARK",
    extractedText: { not: null },
  };
  if (sinceDate) {
    whereClause.createdAt = { gt: new Date(sinceDate) };
  }

  const allBookmarks = await prisma.candidateFile.findMany({
    where: whereClause,
    select: {
      id: true,
      fileName: true,
      extractedText: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // 2. Get batch slice
  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, allBookmarks.length);
  const batchFiles = allBookmarks.slice(start, end);

  if (batchFiles.length === 0) {
    return NextResponse.json({ error: "No files in this batch" }, { status: 400 });
  }

  // 3. Get candidate context directly (no HTTP fetch needed)
  let candidateContext = "";
  try {
    candidateContext = await getCandidateContext(candidateId);
    // Strip bookmark section (we send job postings separately)
    const bookmarkIdx = candidateContext.indexOf("## ブックマーク求人票");
    if (bookmarkIdx !== -1) {
      candidateContext = candidateContext.substring(0, bookmarkIdx).trim();
    }
  } catch (e) {
    console.error("[AnalyzeBatch] Context error:", e);
  }

  // Truncate context to prevent oversized payloads
  if (candidateContext.length > MAX_CONTEXT_CHARS) {
    candidateContext = candidateContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
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
各求人について、以下の3軸でA/B/C/D評価を行うこと：

### ① 本人希望（求職者の希望・志向性とのマッチ度）
- A: 非常に合う — 希望条件・志向性にぴったり
- B: 概ね合う — 大部分は合うが一部妥協点あり
- C: 一部合わない — 希望と乖離する部分がある
- D: 合わない — 希望条件と大きくずれている
判断材料: 業界・職種の志向、年収希望、勤務地、働き方、転職軸との一致度

### ② 通過率（書類選考・面接の通過可能性）

**最初に必ず確認：** 求人の必須要件（学歴・資格・経験年数）を求職者が満たしているかチェックすること。「大卒以上」の求人に大卒でない求職者、「○○資格必須」の求人に資格を持たない求職者は、他の条件がどれだけ合っていても通過率D判定とする。推薦状でのカバー可能性がある場合のみC判定を検討し、その旨を分析コメントに明記すること。

- A: 高い — 経歴・スキルが求人要件に十分合致（必須要件を全て満たしていることが前提）
- B: ある程度見込める — 概ね要件を満たすが一部弱い点あり
- C: 厳しい — 要件との乖離があり、推薦文でのカバーが必要
- D: 非常に厳しい — 経歴・スキルの接続が弱い
判断材料: 必須要件の充足度、経験年数、業界経験、スキルマッチ
補足判断基準:
- 業務委託・BPO・派遣での経験は、自社運営の経験より書類評価が低くなる傾向がある
- 35歳以上で未経験業種への応募は、書類通過率が大幅に下がる
- 求人票の必須要件だけでなく、年齢の上限感、前職の企業規模感、転職回数の許容範囲など暗黙の基準も考慮する
- 固定残業時間が長い求人（30時間超）は、安定志向の求職者にはマイナス評価とする

### ③ 総合（紹介推奨度）
- A: 積極的に紹介 — 本人希望にも合い、通過も見込める
- B: 紹介してよい — バランスが取れている、または片方が強い
- C: 条件付きで検討 — 紹介するなら補足説明や対策が必要
- D: 紹介非推奨 — 本人にも合わず通過も厳しい
判断材料: ①②の総合判断。本人希望Aでも通過率Dなら総合Cにする等、バランスを考慮

## 出力フォーマット
各求人の分析コメントは以下のフォーマットで、簡潔に出力してください。求人と求人の間には必ず空行を2行入れて区切ること：

---

【会社名】求人タイトル

■ 本人希望: A〜D
■ 通過率: A〜D
■ 総合: A〜D

◆ 推薦コメント（3〜5行以内）
この求人をなぜ推薦するか（またはしないか）を簡潔に記載。
マッチするポイント、懸念点、結論を各1文程度で。

---

【重要ルール】
- 推薦コメントは最大5行（150文字程度）に収めること
- 冗長な説明は不要。結論を先に書く
- 箇条書きではなく文章で書く
- 「---」の区切り線で各求人を明確に分離すること

## 重要
- 候補者の経歴情報が不足している場合は、正確な判定はできない旨を明記してください
- 情報が不足している場合でも、求人票の内容は分析し、「候補者情報が不足しているため、求人内容のみの評価です」と前置きしてください
- 推測や仮定で候補者のスキルや経験を補完しないでください`;

  if (isLastBatch) {
    systemPrompt = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。

以下の候補者情報と求人票を分析してください。これは全${totalFiles}件中の最後のバッチ（${start + 1}〜${end}件目）です。

${EVAL_RULES}

## このバッチの分析後、以下の総合まとめを必ず出力すること

最後に以下の形式で総合まとめを出力してください。
ランクごとにセクションを分け、各社は1行ずつ記載し、ランク間には空行を入れること：

━━━━━━━━━━━━━━━━━━━
【総合優先順位（全${totalFiles}件）】
━━━━━━━━━━━━━━━━━━━

■ 総合A（積極的に紹介）

・会社名 — 本人希望:A / 通過率:A
・会社名 — 本人希望:A / 通過率:B

■ 総合B（紹介してよい）

・会社名 — 本人希望:B / 通過率:B
・会社名 — 本人希望:A / 通過率:C

■ 総合C（条件付きで検討）

・会社名 — 本人希望:A / 通過率:D
・会社名 — 本人希望:C / 通過率:B

■ 総合D（紹介非推奨）

・会社名 — 本人希望:D / 通過率:D

- 各ランクのヘッダー（■ 総合A 等）の前後に必ず空行を入れること
- 各社は「・」で始め、1社1行で記載すること（1行に複数社を詰め込まない）
- 該当なしのランクは「該当なし」と記載すること

※これまでのバッチの結果はチャット履歴に含まれています。それを参照して総合まとめを作成してください。`;
  } else {
    systemPrompt = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。

以下の候補者情報と求人票を分析してください。これは全${totalFiles}件中の${start + 1}〜${end}件目です。

${EVAL_RULES}

- このバッチの分析のみ行い、総合まとめは最終バッチで行います
- 「---」の区切り線で各求人を明確に分離すること`;
  }

  // 6. Fetch chat history (for last batch to reference previous analysis)
  const chatMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  const pastMessages = chatMessages.slice(-MAX_PAST_MESSAGES);

  const messagesArray = [
    ...pastMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.length > MAX_CHAT_MESSAGE_CHARS
        ? m.content.substring(0, MAX_CHAT_MESSAGE_CHARS) + "\n...（省略）"
        : m.content,
    })),
    {
      role: "user" as const,
      content: `## 候補者情報\n${candidateContext}\n\n## 検討中の求人票（${start + 1}〜${end}件目 / 全${totalFiles}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
    },
  ];

  // 7. Call Anthropic API
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

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
        model: "claude-opus-4-6",
        max_tokens: 16000,
        temperature: 0.7,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: messagesArray,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[AnalyzeBatch] Anthropic error:", response.status, errText);
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
    const analysisText = data.content?.[0]?.text || "";

    // 8. Save to chat
    const label = isLastBatch
      ? `【求人分析 バッチ${batchIndex + 1}（${start + 1}〜${end}件目）+ 総合まとめ】`
      : `【求人分析 バッチ${batchIndex + 1}（${start + 1}〜${end}件目）】`;

    await prisma.advisorChatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: `ブックマーク求人分析（${start + 1}〜${end}件目 / 全${totalFiles}件）を実行`,
      },
    });

    await prisma.advisorChatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: `${label}\n\n${analysisText}`,
      },
    });

    // 9. Extract ratings + comments and save to CandidateFile
    const ratingsAndComments = extractRatingsAndComments(analysisText, batchFiles);
    for (const [fileId, { rating, comment }] of ratingsAndComments) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = { aiAnalyzedAt: new Date() };
      if (rating) updateData.aiMatchRating = rating;
      if (comment) updateData.aiAnalysisComment = comment;
      await prisma.candidateFile.update({ where: { id: fileId }, data: updateData });
    }
    console.log("[AnalyzeBatch] Extracted ratings:", {
      totalFiles: batchFiles.length,
      extractedCount: ratingsAndComments.size,
      ratings: Object.fromEntries([...ratingsAndComments].map(([id, { rating }]) => [id, rating])),
    });

    return NextResponse.json({
      batchIndex,
      startIndex: start + 1,
      endIndex: end,
      totalFiles: allBookmarks.length,
      isLastBatch: end >= allBookmarks.length,
      analysisText: `${label}\n\n${analysisText}`,
      remainingFiles: allBookmarks.length - end,
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

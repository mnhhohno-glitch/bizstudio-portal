import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const maxDuration = 300; // 5 minutes

function extractRatings(analysisText: string, batchFiles: { id: string; fileName: string }[]): Map<string, string> {
  const ratings = new Map<string, string>();
  for (const file of batchFiles) {
    const fileIndex = analysisText.indexOf(file.fileName);
    if (fileIndex === -1) continue;
    const searchArea = analysisText.substring(fileIndex, fileIndex + 500);
    const ratingMatch = searchArea.match(/相性[：:]\s*([ABCD])/);
    if (ratingMatch) {
      ratings.set(file.id, ratingMatch[1]);
    }
  }
  return ratings;
}

const API_TIMEOUT_MS = 120000;
const MAX_PAST_MESSAGES = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY が未設定です" }, { status: 500 });
  }

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

  // 3. Fetch candidate context (without bookmark texts)
  const baseUrl = process.env.PORTAL_BASE_URL || (req.headers.get("origin") ?? "");
  let candidateContext = "";
  try {
    const contextRes = await fetch(`${baseUrl}/api/candidates/${candidateId}/advisor/context`, {
      headers: { cookie: req.headers.get("cookie") || "" },
    });
    if (contextRes.ok) {
      const contextData = await contextRes.json();
      candidateContext = contextData.context || "";
      // Strip bookmark section if present
      const bookmarkIdx = candidateContext.indexOf("## ブックマーク求人票");
      if (bookmarkIdx !== -1) {
        candidateContext = candidateContext.substring(0, bookmarkIdx).trim();
      }
    }
  } catch (e) {
    console.error("[AnalyzeBatch] Context fetch error:", e);
  }

  // 4. Build job posting section for this batch
  const jobsSection = batchFiles
    .map((f, i) => {
      const globalIndex = start + i + 1;
      const text = f.extractedText!.substring(0, 3000);
      return `### 求人${globalIndex}: ${f.fileName}\n${text}`;
    })
    .join("\n\n---\n\n");

  // 5. Build system prompt
  let systemPrompt: string;

  if (isLastBatch) {
    systemPrompt = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。

以下の候補者情報と求人票を分析してください。これは全${totalFiles}件中の最後のバッチ（${start + 1}〜${end}件目）です。

## ルール
- 各求人について、候補者との相性を A（非常に良い）/ B（良い）/ C（要検討）/ D（合わない）で評価する
- 評価の根拠を具体的に述べる（経験・スキル・志向性のマッチ度）
- 面接で聞かれそうなポイントがあれば記載
- 各求人の分析は200〜300文字程度に収める

## このバッチの分析後、以下の総合まとめを必ず出力すること
最後に「【総合優先順位（全${totalFiles}件）】」というセクションを追加し、
このバッチの求人と、これまでのバッチで分析した全求人を合わせて、
A/B/C/Dのランク別に会社名を一覧化してください。

※これまでのバッチの結果はチャット履歴に含まれています。それを参照して総合まとめを作成してください。`;
  } else {
    systemPrompt = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。

以下の候補者情報と求人票を分析してください。これは全${totalFiles}件中の${start + 1}〜${end}件目です。

## ルール
- 各求人について、候補者との相性を A（非常に良い）/ B（良い）/ C（要検討）/ D（合わない）で評価する
- 評価の根拠を具体的に述べる（経験・スキル・志向性のマッチ度）
- 面接で聞かれそうなポイントがあれば記載
- 各求人の分析は200〜300文字程度に収める
- このバッチの分析のみ行い、総合まとめは最終バッチで行います`;
  }

  // 6. Fetch chat history (for last batch to reference previous analysis)
  const chatMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  const pastMessages = chatMessages.slice(-MAX_PAST_MESSAGES);

  const messages = [
    ...pastMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    {
      role: "user" as const,
      content: `## 候補者情報\n${candidateContext}\n\n## 検討中の求人票（${start + 1}〜${end}件目 / 全${totalFiles}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
    },
  ];

  // 7. Call OpenAI
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_completion_tokens: 16000,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[AnalyzeBatch] OpenAI error:", response.status, errText);
      return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const analysisText = data.choices?.[0]?.message?.content || "";

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

    // 9. Extract A/B/C/D ratings and save to CandidateFile
    const ratings = extractRatings(analysisText, batchFiles);
    for (const [fileId, rating] of ratings) {
      await prisma.candidateFile.update({
        where: { id: fileId },
        data: { aiMatchRating: rating, aiAnalyzedAt: new Date() },
      });
    }
    console.log("[AnalyzeBatch] Ratings saved:", Object.fromEntries(ratings));

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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const maxDuration = 300; // 5 minutes

function extractRatings(
  analysisText: string,
  batchFiles: { id: string; fileName: string }[]
): Map<string, string> {
  const ratings = new Map<string, string>();

  // === Method 1: Extract from summary section ===
  const summaryMatch = analysisText.match(/【総合優先順位[^】]*】([\s\S]*?)(?:$|\n\n\n)/);
  const summarySection = summaryMatch ? summaryMatch[1] : "";

  if (summarySection) {
    const summaryRatings = new Map<string, string>();
    let currentRating = "";

    for (const line of summarySection.split("\n")) {
      const trimmed = line.trim();
      if (/^[ABCD]$/.test(trimmed)) {
        currentRating = trimmed;
        continue;
      }
      if (trimmed === "該当なし" || trimmed === "") continue;
      if (trimmed.startsWith("*")) {
        const companyName = trimmed.replace(/^\*\s*/, "").trim();
        if (companyName && companyName !== "該当なし" && currentRating) {
          summaryRatings.set(companyName, currentRating);
        }
        continue;
      }
      if (currentRating && trimmed.length > 1 && !trimmed.startsWith("【")) {
        summaryRatings.set(trimmed, currentRating);
      }
    }

    for (const file of batchFiles) {
      if (ratings.has(file.id)) continue;
      const searchNames = extractSearchNames(file.fileName);
      for (const [summaryCompany, rating] of summaryRatings) {
        for (const name of searchNames) {
          if (
            summaryCompany.includes(name) ||
            name.includes(summaryCompany) ||
            normalizeCompanyName(summaryCompany) === normalizeCompanyName(name)
          ) {
            ratings.set(file.id, rating);
            break;
          }
        }
        if (ratings.has(file.id)) break;
      }
    }
  }

  // === Method 2: Extract from individual sections ===
  for (const file of batchFiles) {
    if (ratings.has(file.id)) continue;
    const searchNames = extractSearchNames(file.fileName);

    for (const name of searchNames) {
      const nameIndex = analysisText.indexOf(name);
      if (nameIndex === -1) continue;

      const searchStart = Math.max(0, nameIndex - 100);
      const searchEnd = Math.min(analysisText.length, nameIndex + 600);
      const searchArea = analysisText.substring(searchStart, searchEnd);

      const patterns = [
        /■\s*相性[：:]\s*([ABCD])/,
        /相性[：:]\s*([ABCD])/,
        /評価[：:]\s*([ABCD])/,
        /【([ABCD])】/,
        /マッチ度[：:]\s*([ABCD])/,
      ];

      for (const pattern of patterns) {
        const match = searchArea.match(pattern);
        if (match) {
          ratings.set(file.id, match[1]);
          break;
        }
      }
      if (ratings.has(file.id)) break;
    }
  }

  return ratings;
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
  }
  return expanded;
}

function normalizeCompanyName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
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
- 各求人の評価は必ず「■ 相性: A」「■ 相性: B」「■ 相性: C」「■ 相性: D」の形式で記載してください（バッジ表示のため）

## 重要
- 候補者の経歴情報（職務経歴書、履歴書、面談ログなど）が不足している場合は、正確な相性判定はできない旨を明記してください
- 情報が不足している場合でも、求人票の内容は分析し、「候補者情報が不足しているため、求人内容のみの評価です」と前置きしてください
- 推測や仮定で候補者のスキルや経験を補完しないでください

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
- 各求人の評価は必ず「■ 相性: A」「■ 相性: B」「■ 相性: C」「■ 相性: D」の形式で記載してください（バッジ表示のため）
- このバッチの分析のみ行い、総合まとめは最終バッチで行います

## 重要
- 候補者の経歴情報（職務経歴書、履歴書、面談ログなど）が不足している場合は、正確な相性判定はできない旨を明記してください
- 情報が不足している場合でも、求人票の内容は分析し、「候補者情報が不足しているため、求人内容のみの評価です」と前置きしてください
- 推測や仮定で候補者のスキルや経験を補完しないでください`;
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
    console.log("[AnalyzeBatch] Extracted ratings:", {
      totalFiles: batchFiles.length,
      extractedCount: ratings.size,
      ratings: Object.fromEntries(ratings),
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

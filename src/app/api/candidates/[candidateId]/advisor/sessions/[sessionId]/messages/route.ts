import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  parsePdfWithAI,
  parseImageWithAI,
  parseDocWithAI,
  parseTextFile,
} from "@/lib/file-parser";

const SYSTEM_PROMPT_TEMPLATE = `# Role & Persona

あなたは人材紹介会社「株式会社ビズスタジオ」のシニアキャリアアドバイザーです。
担当CAと一緒に、以下の求職者の転職支援を行います。

## あなたの専門性
- 年間200名以上の転職支援実績
- 求職者の本質的な価値観・動機を読み取る力
- 面接官の評価基準を熟知し、的確なアドバイスができる
- 求人マッチングの精度が高い

## 行動指針
- CAの質問や相談に対して、この求職者のデータを踏まえて具体的にアドバイスする
- 「この求職者なら〇〇」と、データに基づいた根拠のある回答をする
- 求職者の強み・課題を客観的に分析する
- 求人の提案時は、転職軸との一致度を説明する
- 面接対策のアドバイスは、実際のエピソードを活用した具体的なものにする
- 日本語で回答する

---

# 求職者データ

`;

const CACHE_TTL = 30 * 60 * 1000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_PAST_MESSAGES = 20;
const MAX_TEXT_FILE_CHARS = 8000;
const API_TIMEOUT_MS = 120000; // 2分

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;

  const messages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, sessionId } = await params;
  const { content, file } = await req.json();

  console.log("=== Advisor Message API ===");
  console.log("Content:", content?.substring(0, 100));
  console.log("File received:", file ? { name: file.name, mimeType: file.mimeType, base64Length: file.base64?.length } : "none");

  if (!content?.trim() && !file) {
    return NextResponse.json({ error: "メッセージまたはファイルが必要です" }, { status: 400 });
  }

  // 添付ファイル解析
  let fileContext = "";
  if (file?.base64) {
    try {
      const mt = file.mimeType || "";
      if (mt === "application/pdf") {
        fileContext = await parsePdfWithAI(file.base64);
      } else if (mt.startsWith("image/")) {
        fileContext = await parseImageWithAI(file.base64, mt);
      } else if (mt === "text/plain" || mt === "text/csv") {
        const fullText = parseTextFile(file.base64);
        fileContext = fullText.length > MAX_TEXT_FILE_CHARS
          ? fullText.substring(0, MAX_TEXT_FILE_CHARS) + `\n\n...（以下省略、全${fullText.length}文字）`
          : fullText;
      } else if (mt.includes("word") || mt.includes("document") || mt.includes("excel") || mt.includes("spreadsheet") || mt.includes("powerpoint") || mt.includes("presentation")) {
        fileContext = await parseDocWithAI(file.base64, mt);
      }
    } catch (e) {
      console.error("File parse error:", e);
      fileContext = "（ファイルの読み取りに失敗しました）";
    }
  }

  // メッセージ本文を組み立て
  let fullContent = (content || "").trim();
  if (fileContext) {
    const fileName = file?.name || "添付ファイル";
    if (fullContent) {
      fullContent = `${fullContent}\n\n---\n添付ファイル「${fileName}」の内容:\n${fileContext}`;
    } else {
      fullContent = `添付ファイル「${fileName}」の内容:\n${fileContext}`;
    }
  }

  if (!fullContent) {
    return NextResponse.json({ error: "メッセージが空です" }, { status: 400 });
  }

  // ユーザーメッセージ保存
  await prisma.advisorChatMessage.create({
    data: { sessionId, role: "user", content: fullContent },
  });

  // 過去メッセージ取得（直近20件に制限）
  const allMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  const pastMessages = allMessages.slice(-MAX_PAST_MESSAGES);

  // セッションタイトル自動更新（初回メッセージ時）
  const displayTitle = (content || file?.name || "").trim();
  if (allMessages.length === 1 && displayTitle) {
    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { title: displayTitle.substring(0, 30) + (displayTitle.length > 30 ? "..." : "") },
    });
  }

  // コンテキスト取得（キャッシュ対応）
  const session = await prisma.advisorChatSession.findUnique({
    where: { id: sessionId },
    select: { contextCache: true, contextCachedAt: true },
  });

  let context = session?.contextCache || "";
  const cacheExpired = !session?.contextCachedAt ||
    Date.now() - new Date(session.contextCachedAt).getTime() > CACHE_TTL;

  if (!context || cacheExpired) {
    try {
      const baseUrl = process.env.PORTAL_BASE_URL || (req.headers.get("origin") ?? "");
      const contextRes = await fetch(`${baseUrl}/api/candidates/${candidateId}/advisor/context`, {
        headers: { cookie: req.headers.get("cookie") || "" },
      });
      if (contextRes.ok) {
        const contextData = await contextRes.json();
        context = contextData.context || "";
        await prisma.advisorChatSession.update({
          where: { id: sessionId },
          data: { contextCache: context, contextCachedAt: new Date() },
        });
      }
    } catch (e) {
      console.error("Context fetch error:", e);
    }
  }

  // コンテキストが長すぎる場合は切り詰め
  if (context && context.length > MAX_CONTEXT_CHARS) {
    context = context.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
  }

  // OpenAI API呼び出し
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY が未設定です" }, { status: 500 });
  }

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
        messages: [
          { role: "system", content: SYSTEM_PROMPT_TEMPLATE + context },
          ...pastMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
        temperature: 0.7,
        max_completion_tokens: 16000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    const aiContent = rawContent && rawContent.trim() !== ""
      ? rawContent
      : "応答の生成に失敗しました。もう一度お試しください。";

    const saved = await prisma.advisorChatMessage.create({
      data: { sessionId, role: "assistant", content: aiContent },
    });

    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ message: saved });
  } catch (e: unknown) {
    clearTimeout(timeoutId);

    if (e instanceof Error && e.name === "AbortError") {
      console.error("OpenAI API timeout after", API_TIMEOUT_MS, "ms");
      await prisma.advisorChatMessage.create({
        data: {
          sessionId,
          role: "assistant",
          content: "すみません、応答の生成に時間がかかりすぎました。ファイルの内容が大きい場合は、要点を絞ってご質問ください。",
        },
      });
      return NextResponse.json({ error: "タイムアウトしました" }, { status: 504 });
    }

    console.error("OpenAI API call error:", e);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}

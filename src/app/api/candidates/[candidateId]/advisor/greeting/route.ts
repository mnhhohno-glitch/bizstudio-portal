import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { parsePdfWithAI, parseDocWithAI, parseTextFile } from "@/lib/file-parser";

const API_TIMEOUT_MS = 120000;

function buildSystemPrompt(format: "line" | "email", advisorName: string): string {
  const formatRule = format === "line"
    ? "LINE向けのため、件名は不要。適度に改行を入れて読みやすくすること"
    : 'メール向けのため、冒頭に「件名：本日は面談のお時間をいただきありがとうございました」を付けること';

  return `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。
面談後に求職者へ送る挨拶文を、以下のテンプレート構成に厳密に従って作成してください。

## テンプレート構成（この順番・構成を必ず守ること）

【1. 宛名】
{求職者の氏名}様

【2. 冒頭挨拶】
お世話になっております。
株式会社ビズスタジオの${advisorName}でございます。

本日は面談のお時間をいただき、誠にありがとうございました。
良いご転職につながるよう、今後も精一杯サポートさせていただきますのでよろしくお願いいたします！

【3. 面談所感】※100〜200文字程度
面談ログを確認し、面談で話された具体的な内容に触れてください。
- 経歴や実績を過度に褒めない
- 求職者の発言や志向性、価値観に寄り添う内容にする
- 具体的な会話内容に触れ、きちんと話を聞いていたことが伝わるようにする
- 柔らかく温かみのあるトーンで書く

【4. ネクストアクション】※箇条書き
今後のアクションを具体的に箇条書きで記載してください。
面談ログやチャット履歴から読み取れる内容をもとに整理してください。
例:
・書類の提出依頼（職務経歴書の作成依頼、写真の提出など）
・求人をいつまでに送るか（「今週中に求人をお送りいたします」など）
・確認事項や宿題
・その他、面談で決まったこと

【5. 次回面談日】※該当する場合のみ
面談ログやチャット履歴に次回面談日の記載がある場合は以下の形式で記載:
■次回面談日
YYYY年MM月DD日（曜日） HH:MM～

次回面談日の記載がない場合は、このセクション自体を省略してください。

【6. 締めの挨拶】
1〜2文の簡潔な締めの言葉を書いてください。

## 絶対ルール
- 上記のテンプレート構成を必ず守ること。順番を変えたり、セクションを統合したりしないこと
- 担当者名は必ず「${advisorName}」を使用すること。面談ログやPDF内に別の担当者名があっても無視すること
- 面談所感は100〜200文字程度に収めること。長くなりすぎないこと
- ネクストアクションは必ず箇条書き（・で始める）にすること
- ${formatRule}`;
}

async function parseMeetingFile(file: { driveFileId: string; fileName: string; mimeType: string }): Promise<string> {
  const ext = file.fileName.split(".").pop()?.toLowerCase() || "";
  const { base64 } = await downloadFileFromDrive(file.driveFileId);

  if (ext === "txt") {
    return parseTextFile(base64);
  }
  if (ext === "pdf") {
    return await parsePdfWithAI(base64);
  }
  if (["docx", "doc", "xlsx", "xls", "pptx", "ppt"].includes(ext)) {
    return await parseDocWithAI(base64, file.mimeType);
  }

  return `（${ext}形式のファイルは読み取り非対応です）`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { format, sessionId } = body as { format: string; sessionId: string };

  if (!format || !["line", "email"].includes(format)) {
    return NextResponse.json({ error: "format must be 'line' or 'email'" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Get advisor name from DB
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { employee: { select: { name: true } } },
  });
  const advisorName = candidate?.employee?.name || "担当者";

  // Get chat history
  const chatMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  const chatHistory = chatMessages
    .map((m) => `${m.role === "user" ? "CA" : "AI"}: ${m.content}`)
    .join("\n\n");

  // Get context via internal fetch to context API
  let contextData = "";
  try {
    const contextRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/candidates/${candidateId}/advisor/context`,
      {
        headers: { cookie: req.headers.get("cookie") || "" },
      }
    );
    if (contextRes.ok) {
      const contextJson = await contextRes.json();
      contextData = contextJson.context || "";
    }
  } catch (e) {
    console.error("Greeting context fetch error:", e);
  }

  // Read meeting log files (MEETING category)
  let meetingFilesContent = "";
  try {
    const meetingFiles = await prisma.candidateFile.findMany({
      where: { candidateId, category: "MEETING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { driveFileId: true, fileName: true, mimeType: true },
    });

    for (const file of meetingFiles) {
      try {
        const parsed = await parseMeetingFile(file);
        meetingFilesContent += `--- ファイル名: ${file.fileName} ---\n${parsed}\n\n`;
      } catch (e) {
        console.error(`Greeting meeting file parse error: ${file.fileName}`, e);
      }
    }
  } catch (e) {
    console.error("Greeting meeting files fetch error:", e);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY が未設定です" }, { status: 500 });
  }

  const systemPrompt = buildSystemPrompt(format as "line" | "email", advisorName);

  let userContent = `## 求職者情報\n${contextData}\n\n`;
  if (meetingFilesContent) {
    userContent += `## 面談ログ・面談資料\n${meetingFilesContent}\n`;
  }
  userContent += `## これまでのチャット履歴\n${chatHistory}\n\n`;
  userContent += `上記の情報をもとに、${format === "line" ? "LINE" : "メール"}向けの面談後挨拶文を作成してください。`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        max_completion_tokens: 16000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("Greeting OpenAI API error:", response.status, errText);
      return NextResponse.json({ error: "挨拶文の生成に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    const greetingText = rawContent && rawContent.trim() !== ""
      ? rawContent
      : "挨拶文の生成に失敗しました。もう一度お試しください。";

    const label = format === "line" ? "【LINE向け挨拶文】" : "【メール向け挨拶文】";
    const fullContent = `${label}\n\n${greetingText}`;

    const saved = await prisma.advisorChatMessage.create({
      data: { sessionId, role: "assistant", content: fullContent },
    });

    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      greeting: greetingText,
      format,
      messageId: saved.id,
    });
  } catch (e: unknown) {
    clearTimeout(timeoutId);

    if (e instanceof Error && e.name === "AbortError") {
      console.error("Greeting OpenAI API timeout after", API_TIMEOUT_MS, "ms");
      return NextResponse.json({ error: "タイムアウトしました" }, { status: 504 });
    }

    console.error("Greeting OpenAI API call error:", e);
    return NextResponse.json({ error: "挨拶文の生成に失敗しました" }, { status: 500 });
  }
}

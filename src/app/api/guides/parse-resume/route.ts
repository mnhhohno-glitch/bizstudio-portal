import { NextResponse } from "next/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "PDFファイルを選択してください" },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "PDFファイルのみアップロード可能です" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "ファイルサイズは10MB以下にしてください" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI機能が設定されていません" },
        { status: 500 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const base64Data = fileBuffer.toString("base64");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: base64Data,
                  },
                },
                {
                  text: `# Task

この職務経歴書PDFの内容を正確に読み取り、構造化してテキストに書き起こしてください。

# Output Rules

- 前置きや説明は不要。いきなり内容から書き始めること
- 原文の情報を **漏れなく・正確に** 抽出すること
- 読み取れない部分は「（読み取り不可）」と記載すること
- 以下のフォーマットで出力すること

# Output Format

## 基本情報
- 氏名:
- 年齢:（記載があれば）
- 最終学歴:（記載があれば）

## 職務経歴

### 【会社名】（在籍期間）
- 事業内容:
- 雇用形態:（記載があれば）
- 部署・役職:
- 業務内容:
  - （箇条書きで詳細に）
- 実績・成果:（記載があれば）
  - （箇条書きで詳細に）

（複数社ある場合は繰り返す）

## 保有スキル・資格
- （箇条書き）

## 自己PR・特記事項
（記載があれば原文に忠実に抽出）`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 3000,
          },
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "PDF解析に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    const data = await response.json();
    const parsedResume = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!parsedResume) {
      return NextResponse.json(
        { error: "PDF解析に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    return NextResponse.json({ parsedResume });
  } catch {
    return NextResponse.json(
      { error: "PDF解析に失敗しました。しばらく経ってから再度お試しください" },
      { status: 500 }
    );
  }
}

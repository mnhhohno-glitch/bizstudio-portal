import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI機能が設定されていません" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "PDFファイルを選択してください" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDFファイルのみアップロード可能です" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "ファイルサイズは10MB以下にしてください" }, { status: 400 });
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
                  text: `以下はWEB履歴書（転職サイトの登録情報）のPDFから抽出したテキストです。
以下の項目を抽出し、JSON形式で返却してください。

## 抽出項目
- name: 氏名（姓と名の間に半角スペース）
- furigana: フリガナ（カタカナ、姓と名の間に半角スペース）
- gender: 性別（"male" or "female"）
- birthday: 生年月日（YYYY-MM-DD形式）
- email: メールアドレス
- phone: 電話番号（ハイフンなし、数字のみ）
- address: 住所（都道府県から）

## ルール
- テキストに含まれない項目はnullにする
- 推測で値を補完しない
- JSON以外の文字は出力しない（\`\`\`jsonなどのマークダウンも不要）
- 性別は "male" または "female" で出力する`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
    }

    // JSONをパース（```jsonラッパーがある場合も対応）
    const jsonStr = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);

    return NextResponse.json({
      name: parsed.name || null,
      furigana: parsed.furigana || null,
      gender: parsed.gender || null,
      birthday: parsed.birthday || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
    });
  } catch (error) {
    console.error("Parse resume error:", error);
    return NextResponse.json({ error: "PDF解析に失敗しました" }, { status: 500 });
  }
}

/**
 * WEB履歴書PDF を Gemini API で直接解析し、構造化フィールドを抽出する。
 * 求職者新規登録モーダル（/api/candidates/parse-resume）と同じモデル・プロンプトを使用し、
 * マイナビRPA（pdf-upload）でも同一の解析経路を共有する。
 */

const GEMINI_MODEL = "gemini-3-flash-preview";

export type GeminiResumeResult = {
  name: string | null;
  furigana: string | null;
  gender: string | null;
  birthday: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  desiredJobType1: string | null;
  desiredJobType2: string | null;
  desiredIndustry1: string | null;
  desiredIndustry2: string | null;
  desiredPrefecture1: string | null;
  desiredPrefecture2: string | null;
  desiredEmploymentType: string | null;
  desiredSalaryMin: number | null;
  consultantName: string | null;
  applicationRoute: string | null;
  mediaSource: string | null;
  applicationDate: string | null;
};

const RESUME_PROMPT = `以下はWEB履歴書（転職サイトの登録情報）のPDFから抽出したテキストです。
以下の項目を抽出し、JSON形式で返却してください。

## 抽出項目（個人情報）
- name: 氏名（姓と名の間に半角スペース）
- furigana: フリガナ（カタカナ、姓と名の間に半角スペース）
- gender: 性別（"male" or "female"）
- birthday: 生年月日（YYYY-MM-DD形式）
- email: メールアドレス
- phone: 電話番号（ハイフンなし、数字のみ）
- address: 住所（都道府県から）

## 抽出項目（希望条件 - 該当セクションがあれば）
- desiredJobType1: 希望職種の第1希望（例 営業事務・営業アシスタント）
- desiredJobType2: 希望職種の第2希望（例 一般事務・庶務）
- desiredIndustry1: 希望業種の第1希望
- desiredIndustry2: 希望業種の第2希望
- desiredPrefecture1: 希望勤務地の第1希望（都道府県、例 神奈川県）
- desiredPrefecture2: 希望勤務地の第2希望（都道府県、例 東京都）
- desiredEmploymentType: 希望雇用形態（正社員/契約社員/派遣社員/パート・アルバイト/業務委託/その他 のいずれか）
- desiredSalaryMin: 希望年収の下限（万円単位の整数、例 450）

## 抽出項目（応募情報 - 該当セクションがあれば）
- consultantName: コンサルタント名（スカウト配信者の氏名、例「藤本なつみ」）
- applicationRoute: 応募経路（マイナビ転職スカウト経由なら「スカウト」、それ以外は推定可能なら値、不明なら null）
- mediaSource: 媒体名（PDFが「マイナビ転職」のWEB履歴書なら「マイナビ転職」、それ以外は推定可能なら値、不明なら null）
- applicationDate: 応募日（PDFの「応募内容」枠に記載された応募日時から日付部分を抽出し YYYY-MM-DD 形式で返す。時刻は不要。記載が見つからなければ null。推測で埋めない）

## ルール
- テキストに含まれない項目はnullにする
- 推測で値を補完しない
- JSON以外の文字は出力しない（\`\`\`jsonなどのマークダウンも不要）
- 性別は "male" または "female" で出力する`;

/**
 * PDF バッファを Gemini API に送信し、履歴書フィールドを抽出する。
 * 失敗時（API キー未設定 / API エラー / レスポンス不正 / JSON 解析失敗）は throw する。
 * 呼び出し側で catch し、AI 解析失敗として扱うこと。
 */
export async function parseResumeWithGemini(
  pdfBuffer: Buffer,
): Promise<GeminiResumeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const base64Data = pdfBuffer.toString("base64");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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
              { text: RESUME_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4000,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Gemini レスポンスが空です");
  }

  let parsed: Record<string, unknown>;
  try {
    // Gemini が ```json ... ``` ラッパーや前文テキストを付与する場合がある
    // 1) マークダウンコードブロック内の JSON を抽出
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    // 2) コードブロックがなければ最初の { から最後の } までを抽出
    const jsonStr = codeBlockMatch
      ? codeBlockMatch[1].trim()
      : rawText.substring(
          rawText.indexOf("{"),
          rawText.lastIndexOf("}") + 1,
        );
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error(
      "[gemini-resume-parser] JSON parse failed. rawText (500 chars):",
      rawText.substring(0, 500),
    );
    throw new Error("Gemini レスポンスのJSON解析に失敗しました");
  }

  return {
    name: (parsed.name as string) || null,
    furigana: (parsed.furigana as string) || null,
    gender: (parsed.gender as string) || null,
    birthday: (parsed.birthday as string) || null,
    email: (parsed.email as string) || null,
    phone: (parsed.phone as string) || null,
    address: (parsed.address as string) || null,
    desiredJobType1: (parsed.desiredJobType1 as string) || null,
    desiredJobType2: (parsed.desiredJobType2 as string) || null,
    desiredIndustry1: (parsed.desiredIndustry1 as string) || null,
    desiredIndustry2: (parsed.desiredIndustry2 as string) || null,
    desiredPrefecture1: (parsed.desiredPrefecture1 as string) || null,
    desiredPrefecture2: (parsed.desiredPrefecture2 as string) || null,
    desiredEmploymentType: (parsed.desiredEmploymentType as string) || null,
    desiredSalaryMin:
      typeof parsed.desiredSalaryMin === "number" ? parsed.desiredSalaryMin : null,
    consultantName: (parsed.consultantName as string) || null,
    applicationRoute: (parsed.applicationRoute as string) || null,
    mediaSource: (parsed.mediaSource as string) || null,
    applicationDate: (parsed.applicationDate as string) || null,
  };
}

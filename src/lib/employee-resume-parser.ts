/**
 * 履歴書・入社書類を Gemini API で直接読み取り、社員詳細タブのstateキーに合わせた
 * 構造化JSONを返す。/api/admin/employees/[employeeId]/parse-resume 専用。
 * 求職者向けの src/lib/gemini-resume-parser.ts を社員用に複製し、フィールドを差し替えた。
 * PDF/Word/画像をネイティブ理解可能（OCR/抽出ライブラリ不要）。
 */

const GEMINI_MODEL = "gemini-3-flash-preview";

export type EmployeeResumeResult = {
  // 基本情報
  name: string | null;
  furigana: string | null; // カタカナ
  birthday: string | null; // YYYY-MM-DD
  gender: string | null;   // "男" | "女" | null
  postalCode: string | null; // ハイフンなし7桁
  address: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  // 社会保険（番号類のみ）
  pensionNumber: string | null;            // 基礎年金番号
  employmentInsuranceNumber: string | null; // 雇用保険被保険者番号
  // 口座
  bankName: string | null;
  bankCode: string | null;     // 4桁ゼロ詰め
  branchName: string | null;
  branchCode: string | null;   // 3桁ゼロ詰め
  accountType: string | null;  // "普通" | "当座"
  accountNumber: string | null;
  accountHolderKana: string | null;
};

const EMPLOYEE_RESUME_PROMPT = `添付されたファイルは社員の履歴書・入社書類です（PDF/Word/画像のいずれか）。
複数の書類（履歴書・通帳コピー・年金手帳・雇用保険被保険者証など）が同時に渡される場合があります。
その場合は全書類を横断して各項目を抽出し、同一項目が複数書類にある場合は最も信頼できる記載を採用してください。
以下の項目を抽出し、指定キーのJSONのみを返却してください。

## 抽出項目（基本情報）
- name: 氏名（姓と名の間に半角スペース）
- furigana: フリガナ（カタカナ、姓と名の間に半角スペース）
- birthday: 生年月日（YYYY-MM-DD形式。記載の暦日をそのまま。タイムゾーン変換しない）
- gender: 性別（"男" または "女" のいずれか。判定不能なら null）
- postalCode: 郵便番号（ハイフンなし7桁の数字）
- address: 住所（都道府県から建物名まで、記載どおり）
- phone: 本人の電話番号（ハイフンなし、数字のみ）
- emergencyContactName: 緊急連絡先の氏名
- emergencyContactRelation: 緊急連絡先の続柄（例: 父・母・配偶者）
- emergencyContactPhone: 緊急連絡先の電話番号（ハイフンなし、数字のみ）

## 抽出項目（社会保険の番号類のみ）
- pensionNumber: 基礎年金番号（記載のとおり）
- employmentInsuranceNumber: 雇用保険被保険者番号（記載のとおり）

## 抽出項目（給与振込口座）
- bankName: 銀行名（例「みずほ銀行」）
- bankCode: 金融機関コード（4桁・先頭ゼロを保持した文字列。例 "0001"）
- branchName: 支店名
- branchCode: 支店コード（3桁・先頭ゼロを保持した文字列。例 "001"）
- accountType: 口座種別（"普通" または "当座" のみ）
- accountNumber: 口座番号（数字のみ）
- accountHolderKana: 口座名義（カタカナ）

## ルール
- 記載がない項目は必ず null にする
- 推測で値を補完しない（不確実なら null）
- JSON以外の文字は出力しない（\`\`\`json などのマークダウンも不要）
- 数字のみのフィールドは数字以外の文字を含めない
- コードのゼロ詰めは必ず保持する（"1" ではなく "0001" のように）`;

/**
 * ファイル Buffer を Gemini API に送信し、社員詳細用フィールドを抽出する。
 * 失敗時（APIキー未設定 / APIエラー / レスポンス不正 / JSON解析失敗）は throw する。
 * 呼び出し側で catch し、AI解析失敗として扱うこと。
 */
export type ResumeFileInput = { buffer: Buffer; mimeType: string };

export async function parseEmployeeResume(
  files: ResumeFileInput[],
): Promise<EmployeeResumeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }
  if (files.length === 0) {
    throw new Error("ファイルが指定されていません");
  }

  // 全ファイルの inlineData を並べ＋プロンプト1本で1リクエストにまとめる
  const parts = [
    ...files.map((f) => ({
      inlineData: { mimeType: f.mimeType, data: f.buffer.toString("base64") },
    })),
    { text: EMPLOYEE_RESUME_PROMPT },
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
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
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = codeBlockMatch
      ? codeBlockMatch[1].trim()
      : rawText.substring(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1);
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error(
      "[employee-resume-parser] JSON parse failed. rawText (500 chars):",
      rawText.substring(0, 500),
    );
    throw new Error("Gemini レスポンスのJSON解析に失敗しました");
  }

  const s = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  // gender は "男"/"女" のみ受け付ける
  const rawGender = s(parsed.gender);
  const gender =
    rawGender === "男" || rawGender === "女" ? rawGender : null;

  // コードのゼロ詰めを保証（数字以外を除いてpadStart）
  const padCode = (v: unknown, len: number): string | null => {
    const t = s(v);
    if (!t) return null;
    const digits = t.replace(/\D/g, "");
    if (!digits) return null;
    return digits.padStart(len, "0").slice(-len);
  };

  // 電話番号・郵便番号・口座番号は数字のみに正規化
  const digitsOnly = (v: unknown): string | null => {
    const t = s(v);
    if (!t) return null;
    const digits = t.replace(/\D/g, "");
    return digits || null;
  };

  return {
    name: s(parsed.name),
    furigana: s(parsed.furigana),
    birthday: s(parsed.birthday),
    gender,
    postalCode: digitsOnly(parsed.postalCode)?.padStart(7, "0").slice(-7) ?? null,
    address: s(parsed.address),
    phone: digitsOnly(parsed.phone),
    emergencyContactName: s(parsed.emergencyContactName),
    emergencyContactRelation: s(parsed.emergencyContactRelation),
    emergencyContactPhone: digitsOnly(parsed.emergencyContactPhone),
    pensionNumber: s(parsed.pensionNumber),
    employmentInsuranceNumber: s(parsed.employmentInsuranceNumber),
    bankName: s(parsed.bankName),
    bankCode: padCode(parsed.bankCode, 4),
    branchName: s(parsed.branchName),
    branchCode: padCode(parsed.branchCode, 3),
    accountType:
      s(parsed.accountType) === "普通" || s(parsed.accountType) === "当座"
        ? s(parsed.accountType)
        : null,
    accountNumber: digitsOnly(parsed.accountNumber),
    accountHolderKana: s(parsed.accountHolderKana),
  };
}

/** 後方互換: 単一ファイル版（既存のボタン経路から呼ばれる）。 */
export async function parseEmployeeResumeWithGemini(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<EmployeeResumeResult> {
  return parseEmployeeResume([{ buffer: fileBuffer, mimeType }]);
}

/**
 * WEB履歴書PDF を Gemini API で直接解析し、構造化フィールドを抽出する。
 * 求職者新規登録モーダル（/api/candidates/parse-resume）と同じモデル・プロンプトを使用し、
 * マイナビRPA（pdf-upload）でも同一の解析経路を共有する。
 */

import { recordGeminiUsage } from "@/lib/ai-usage";

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
  mynaviMemberNo: string | null;
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
- mynaviMemberNo: マイナビ会員No（「会員No.：」または「会員番号：」というラベルの直後にある"ちょうど10桁の数字"を抽出する。ラベルが見つからない／10桁の数字でない場合は null。電話番号・郵便番号・日付・スカウトNo・その他の番号と混同しない）

## ルール
- テキストに含まれない項目はnullにする
- 推測で値を補完しない
- JSON以外の文字は出力しない（\`\`\`jsonなどのマークダウンも不要）
- 性別は "male" または "female" で出力する`;

/**
 * リトライ計画。
 * 1回目は現行どおり maxOutputTokens=4000（happy path の挙動を変えない）。
 * 2回目以降は出力枠を広げる。gemini-3-flash-preview は thinking モデルで
 * 思考トークンも同じ出力枠を消費するため、同一PDFでも思考量のブレだけで
 * 4000 に到達して JSON が途中で切れることがある（実測: 成功 1363〜3100 / 失敗は全て 3996）。
 * 枠は上限であって予約ではないため、広げても実際に生成した分しか課金されない。
 */
const ATTEMPT_PLAN: ReadonlyArray<{ maxOutputTokens: number; delayMs: number }> = [
  { maxOutputTokens: 4000, delayMs: 0 },
  { maxOutputTokens: 8192, delayMs: 1000 },
  { maxOutputTokens: 8192, delayMs: 3000 },
];

/** 再試行しても結果が変わらない finishReason（内容起因のブロック） */
const NON_RETRYABLE_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
]);

type AttemptResult =
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; retryable: boolean; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gemini への 1 回分の呼び出し。throw せず AttemptResult を返す
 * （リトライ可否をログ付きで呼び出し側に判断させるため）。
 */
async function attemptParseResume(params: {
  apiKey: string;
  base64Data: string;
  pdfBytes: number;
  maxOutputTokens: number;
  attempt: number;
  totalAttempts: number;
  logMeta?: Record<string, unknown>;
}): Promise<AttemptResult> {
  const { apiKey, base64Data, pdfBytes, maxOutputTokens, attempt, totalAttempts, logMeta } = params;
  const tag = `[gemini-resume-parser] attempt ${attempt}/${totalAttempts} (maxOutputTokens=${maxOutputTokens})`;

  let response: Response;
  try {
    response = await fetch(
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
            maxOutputTokens,
          },
        }),
      },
    );
  } catch (e) {
    // ネットワーク断・タイムアウト等。典型的な一時障害なのでリトライする
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${tag} fetch failed:`, msg);
    return { ok: false, retryable: true, message: `Gemini API 通信エラー: ${msg}` };
  }

  if (!response.ok) {
    // 原因追跡用: HTTPステータスに加えてレスポンスボディの先頭500文字を残す
    // （AI Studio 側は成功率100%に見えても、ここで落ちていれば本文にエラー詳細が入る）
    let errorBody = "";
    try {
      errorBody = (await response.text()).substring(0, 500);
    } catch {
      errorBody = "(body 読み取り失敗)";
    }
    console.error(`${tag} Gemini API error. status=${response.status} body(500):`, errorBody);
    // 429=レート制限 / 5xx=サーバ側障害 は一時的。4xx（キー不正・リクエスト不正）は再試行しても同じ
    const retryable = response.status === 429 || response.status >= 500;
    return { ok: false, retryable, message: `Gemini API error: ${response.status}` };
  }

  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: Record<string, number>;
  };
  try {
    data = await response.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${tag} response.json() failed. status=${response.status}:`, msg);
    return { ok: false, retryable: true, message: `Gemini レスポンスがJSONではありません: ${msg}` };
  }
  // finishReason は成否判定には使わず、失敗時のログ用にのみ保持する
  // （MAX_TOKENS = 出力途中切れ、SAFETY = ブロック 等の切り分けに必要）
  const finishReason: string | null = data?.candidates?.[0]?.finishReason ?? null;

  // T-135: 費用記録（fire-and-forget）。空レスポンスで throw する前に記録する
  // （空でも入力トークンは課金されるため、ここで漏らすと「見えない費用」になる）。
  void recordGeminiUsage({
    system: "portal",
    endpoint: "resume-parse",
    model: GEMINI_MODEL,
    usage: data?.usageMetadata,
    // attempt / maxOutputTokens も残す。リトライ分も1コール1行で課金されるため、
    // 帳簿上どの試行の費用かを後から切り分けられるようにする。
    meta: { pdfBytes, finishReason, attempt, maxOutputTokens, ...logMeta },
  });

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText || typeof rawText !== "string") {
    console.error(
      `${tag} Empty response. status=${response.status} finishReason=${finishReason ?? "null"} body(500):`,
      JSON.stringify(data).substring(0, 500),
    );
    // 思考トークンだけで出力枠を使い切ると本文が空になる。枠を広げれば通る可能性がある
    return {
      ok: false,
      retryable: !NON_RETRYABLE_FINISH_REASONS.has(finishReason ?? ""),
      message: `Gemini レスポンスが空です（finishReason=${finishReason ?? "null"}）`,
    };
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
      `${tag} JSON parse failed. status=${response.status} finishReason=${finishReason ?? "null"} rawTextLength=${rawText.length} rawText(500):`,
      rawText.substring(0, 500),
    );
    // finishReason はエラーメッセージにも載せる。Railway のログは流れて消えるが、
    // MynaviRpaProcessingLog.errorMessage は残るため後追い調査ができる。
    return {
      ok: false,
      retryable: !NON_RETRYABLE_FINISH_REASONS.has(finishReason ?? ""),
      message: `Gemini レスポンスのJSON解析に失敗しました（finishReason=${finishReason ?? "null"}）`,
    };
  }

  return { ok: true, parsed };
}

/**
 * PDF バッファを Gemini API に送信し、履歴書フィールドを抽出する。
 * 一時的な失敗（レート制限 / 5xx / 通信断 / 出力枠到達による途中切れ）は
 * ATTEMPT_PLAN に従って最大3回まで自動リトライする。
 * 全試行が失敗した場合、および再試行しても無駄な失敗（キー未設定 / 4xx / 内容ブロック）は throw する。
 * 呼び出し側で catch し、AI 解析失敗として扱うこと。
 */
export async function parseResumeWithGemini(
  pdfBuffer: Buffer,
  /** T-135: 費用帳簿の付帯情報（呼び出し元・候補者など）。 */
  logMeta?: Record<string, unknown>,
): Promise<GeminiResumeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const base64Data = pdfBuffer.toString("base64");
  const totalAttempts = ATTEMPT_PLAN.length;

  let parsed: Record<string, unknown> | null = null;
  let lastMessage = "Gemini 解析に失敗しました";

  for (let i = 0; i < totalAttempts; i++) {
    const plan = ATTEMPT_PLAN[i];
    if (plan.delayMs > 0) await sleep(plan.delayMs);

    const result = await attemptParseResume({
      apiKey,
      base64Data,
      pdfBytes: pdfBuffer.length,
      maxOutputTokens: plan.maxOutputTokens,
      attempt: i + 1,
      totalAttempts,
      logMeta,
    });

    if (result.ok) {
      if (i > 0) {
        console.warn(
          `[gemini-resume-parser] リトライで成功 (attempt ${i + 1}/${totalAttempts}, maxOutputTokens=${plan.maxOutputTokens})`,
        );
      }
      parsed = result.parsed;
      break;
    }

    lastMessage = result.message;
    if (!result.retryable) {
      throw new Error(lastMessage);
    }
  }

  if (!parsed) {
    throw new Error(`${lastMessage}｜${totalAttempts}回リトライしても解析できませんでした`);
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
    mynaviMemberNo: (parsed.mynaviMemberNo as string) || null,
  };
}

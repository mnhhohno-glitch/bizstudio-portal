// T-132: タイプ診断の自由文（advisor_chat_messages.content）から希望条件を AI で構造化抽出する。
//
// 診断AIのプロンプト/SKILL は変更しない（診断体験を不変に保つ）。本モジュールは「後読み」専用で、
// 診断応答が保存された後に別コール（Gemini）で {職種/都道府県/年収} を抽出し advisor_type_diagnosis に保存する。
//
// 抽出結果は おすすめ③seed（/api/external/candidate-site/preferences）の面談フォールバック源になる。
// 失敗は握り潰す（診断体験・チャット応答に影響させない）。拾い直しはバッチ（backfill）が担う。

import { prisma } from "@/lib/prisma";
import {
  generateWithGeminiDetailed,
  parseJsonResponse,
  GEMINI_MODEL_ID,
  type GeminiUsage,
} from "@/lib/ai/gemini-client";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

// 診断応答の検出。SKILL の「■ 検索条件（推奨）」「職種キーワード」を含む assistant 応答のみを対象にする。
// 雑談・短い確認応答は誤検出しない（安全側）。
export function isDiagnosisContent(content: string | null | undefined): boolean {
  if (!content) return false;
  return /検索条件[（(]?\s*推奨/.test(content) || /職種キーワード/.test(content);
}

// Gemini 抽出の生 JSON 形。年収は全て「万円・年額」。月給のみ別枠（monthlySalaryMan＝月額万円）。
export type DiagnosisExtraction = {
  diagnosisType: string | null;
  desiredJobTypes: string[];
  desiredPrefectures: string[];
  acceptableSalaryFloor: number | null; // 許容下限（年・万円）
  acceptableSalaryCeiling: number | null; // 許容上限（年・万円）※あれば
  monthlySalaryMan: number | null; // 月給（月・万円）※月給しか無い場合の年収換算用
  idealSalaryMin: number | null; // 理想レンジ下限（年・万円）
  idealSalaryMax: number | null; // 理想レンジ上限（年・万円）
};

// advisor_type_diagnosis へ保存する確定値（採用ルール適用後）。
export type DiagnosisRow = {
  diagnosisType: string | null;
  desiredJobTypes: string[];
  desiredPrefectures: string[];
  desiredSalaryMin: number | null;
  desiredSalaryMax: number | null;
  idealSalaryMin: number | null;
  idealSalaryMax: number | null;
};

const SYSTEM_INSTRUCTION = `あなたは人材紹介の求人検索条件アナリストです。
CA向けに書かれた「タイプ診断＋検索条件（推奨）」の日本語散文から、求人検索に使う希望条件だけを構造化して抽出します。
出力は指定 JSON スキーマのみ。推測で埋めず、確信が持てない項目は null（配列は空）にします（誤った希望条件を作らないこと＝fail-safe）。

## 年収（最重要ルール）
散文には「理想」「許容下限」「月給」が混在します。以下を厳密に区別すること（すべて万円・年額の整数で出力。月給のみ月額万円）:
- acceptableSalaryFloor: 「許容下限」「最低」「〜以上は欲しい」等の下限。**最優先で採用**。
- acceptableSalaryCeiling: 許容側に上限の明記があれば。無ければ null。
- monthlySalaryMan: 「月給」「月給ベース」「月給換算」等の**月額**（万円）。年額が別途あってもここは月額のまま。
- idealSalaryMin / idealSalaryMax: 「理想」「理想：600〜800万」等の理想レンジ（年・万円）。片方のみなら片方に。
- 「700万円」→ 700、「35万（月給）」→ monthlySalaryMan=35。「600〜800万」→ min=600,max=800。
- 数値が全く無い/曖昧な年収は全項目 null。

## エリア（都道府県へ正規化）
desiredPrefectures は日本の**都道府県名**の配列に正規化する:
- 「愛知県内」→「愛知県」、「東京23区内」「23区内」→「東京都」、「さいたま市」→「埼玉県」、「名古屋市近郊」→「愛知県」。
- 「第1希望：埼玉県／第2希望：東京都」等、複数あれば優先順に全て入れる。
- 都道府県に落とせない曖昧表現（「関東」「都市部」等）は含めない。除外指定（「〜は除外」）の県は入れない。

## 職種（原文のまま）
desiredJobTypes は診断の「職種キーワード」を**原文の語のまま**配列化（「」やカンマ・改行で区切られた各語）。マスタへの寄せはしない。避けるべき職種は入れない。

## 診断タイプ
diagnosisType は6タイプ志向性診断の判定タイプ名が本文にあれば入れる。無ければ null。`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    diagnosisType: { type: "STRING", nullable: true },
    desiredJobTypes: { type: "ARRAY", items: { type: "STRING" } },
    desiredPrefectures: { type: "ARRAY", items: { type: "STRING" } },
    acceptableSalaryFloor: { type: "INTEGER", nullable: true },
    acceptableSalaryCeiling: { type: "INTEGER", nullable: true },
    monthlySalaryMan: { type: "INTEGER", nullable: true },
    idealSalaryMin: { type: "INTEGER", nullable: true },
    idealSalaryMax: { type: "INTEGER", nullable: true },
  },
  required: ["desiredJobTypes", "desiredPrefectures"],
} as const;

const MAX_INPUT_CHARS = 12000;

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Gemini 生応答を DiagnosisExtraction に正規化。 */
export function normalizeExtraction(raw: unknown): DiagnosisExtraction {
  const o = (raw ?? {}) as Record<string, unknown>;
  const dt = typeof o.diagnosisType === "string" && o.diagnosisType.trim() ? o.diagnosisType.trim() : null;
  return {
    diagnosisType: dt,
    desiredJobTypes: toStrArray(o.desiredJobTypes),
    desiredPrefectures: toStrArray(o.desiredPrefectures),
    acceptableSalaryFloor: toIntOrNull(o.acceptableSalaryFloor),
    acceptableSalaryCeiling: toIntOrNull(o.acceptableSalaryCeiling),
    monthlySalaryMan: toIntOrNull(o.monthlySalaryMan),
    idealSalaryMin: toIntOrNull(o.idealSalaryMin),
    idealSalaryMax: toIntOrNull(o.idealSalaryMax),
  };
}

/**
 * 採用ルールを適用して保存行を確定する。
 * - desiredSalaryMin = 許容下限（最優先）。無ければ 月給×12。理想額は**入れない**（別枠 idealSalary へ）。
 * - desiredSalaryMax = 許容上限 ?? 理想レンジ上限 ?? null（検索の上限ヒント。無害な範囲で活用）。
 * - idealSalaryMin/Max は理想額として別枠保管（seed の min には使わない）。
 */
export function applyRulesToRow(e: DiagnosisExtraction): DiagnosisRow {
  const min =
    e.acceptableSalaryFloor != null
      ? e.acceptableSalaryFloor
      : e.monthlySalaryMan != null
        ? e.monthlySalaryMan * 12
        : null;
  const max = e.acceptableSalaryCeiling != null ? e.acceptableSalaryCeiling : e.idealSalaryMax;
  // min > max の破綻は max を無効化（誤 seed 防止）。
  const safeMax = min != null && max != null && max < min ? null : max;
  return {
    diagnosisType: e.diagnosisType,
    desiredJobTypes: e.desiredJobTypes,
    desiredPrefectures: e.desiredPrefectures,
    desiredSalaryMin: min,
    desiredSalaryMax: safeMax ?? null,
    idealSalaryMin: e.idealSalaryMin,
    idealSalaryMax: e.idealSalaryMax,
  };
}

export function rowHasAnySignal(r: DiagnosisRow): boolean {
  return (
    r.desiredJobTypes.length > 0 ||
    r.desiredPrefectures.length > 0 ||
    r.desiredSalaryMin != null ||
    r.desiredSalaryMax != null
  );
}

/** Gemini を1回呼んで抽出（usage も返す）。パース失敗・API 失敗は例外を投げる。 */
export async function extractDiagnosisPreferences(diagnosisText: string): Promise<{
  extraction: DiagnosisExtraction;
  row: DiagnosisRow;
  usage: GeminiUsage;
  model: string;
  raw: unknown;
}> {
  const clipped = diagnosisText.length > MAX_INPUT_CHARS ? diagnosisText.slice(0, MAX_INPUT_CHARS) : diagnosisText;
  const { text, usage } = await generateWithGeminiDetailed({
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: `以下はCA向けのタイプ診断＋検索条件の散文です。希望条件だけを JSON で抽出してください。\n\n---\n${clipped}`,
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA as unknown as object,
    temperature: 0.1,
    // gemini-3-flash-preview は thinking モデルで思考トークン(~1300)が maxOutputTokens を食う。
    // 2048 だと職種配列が長い診断で出力が途中で切れ JSON 破損 → 6144 で余裕を持たせる。
    maxOutputTokens: 6144,
    // T-135: AI費用帳簿へ記録。この endpoint は既存の AdvisorUsageLog にも入る（既存レポート非回帰のため両方に残す）。
    log: { endpoint: "diagnosis-extract" },
  });
  const raw = parseJsonResponse<unknown>(text);
  const extraction = normalizeExtraction(raw);
  const row = applyRulesToRow(extraction);
  return { extraction, row, usage, model: GEMINI_MODEL_ID, raw };
}

export type RunExtractionResult =
  | { ok: true; saved: boolean; reason: "saved" | "no-signal"; row: DiagnosisRow }
  | { ok: false; reason: "not-diagnosis" | "error"; error?: string };

/**
 * 診断1件を抽出→保存（候補者1名につき1行を upsert）。
 * fire-and-forget からも安全に呼べるよう、例外は投げずに結果オブジェクトで返す。
 * recordUsage=true でコストを AdvisorUsageLog に記録。
 */
export async function runDiagnosisExtraction(params: {
  candidateId: string;
  sessionId: string | null;
  messageId: string;
  diagnosisText: string;
  recordUsage?: boolean;
}): Promise<RunExtractionResult> {
  if (!isDiagnosisContent(params.diagnosisText)) {
    return { ok: false, reason: "not-diagnosis" };
  }
  try {
    const { extraction, row, usage, model, raw } = await extractDiagnosisPreferences(params.diagnosisText);

    if (params.recordUsage !== false) {
      await recordAdvisorUsage({
        endpoint: "diagnosis-extract",
        model,
        usage: { input_tokens: usage.promptTokenCount, output_tokens: usage.candidatesTokenCount },
        candidateId: params.candidateId,
        note: "gemini",
      });
    }

    if (!rowHasAnySignal(row)) {
      // 希望条件が1つも取れなければ保存しない（空行で seed を汚さない）。
      return { ok: true, saved: false, reason: "no-signal", row };
    }

    await prisma.advisorTypeDiagnosis.upsert({
      where: { candidateId: params.candidateId },
      create: {
        candidateId: params.candidateId,
        diagnosisType: row.diagnosisType,
        desiredJobTypes: row.desiredJobTypes,
        desiredPrefectures: row.desiredPrefectures,
        desiredSalaryMin: row.desiredSalaryMin,
        desiredSalaryMax: row.desiredSalaryMax,
        idealSalaryMin: row.idealSalaryMin,
        idealSalaryMax: row.idealSalaryMax,
        sourceMessageId: params.messageId,
        sourceSessionId: params.sessionId,
        extractionModel: model,
        rawJson: raw as object,
      },
      update: {
        diagnosisType: row.diagnosisType,
        desiredJobTypes: row.desiredJobTypes,
        desiredPrefectures: row.desiredPrefectures,
        desiredSalaryMin: row.desiredSalaryMin,
        desiredSalaryMax: row.desiredSalaryMax,
        idealSalaryMin: row.idealSalaryMin,
        idealSalaryMax: row.idealSalaryMax,
        sourceMessageId: params.messageId,
        sourceSessionId: params.sessionId,
        extractionModel: model,
        rawJson: raw as object,
        extractedAt: new Date(),
      },
    });
    void extraction; // 監査用に raw を保存済み
    return { ok: true, saved: true, reason: "saved", row };
  } catch (e) {
    console.error(`[diagnosis-extract] failed candidate=${params.candidateId} msg=${params.messageId}:`, e);
    return { ok: false, reason: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

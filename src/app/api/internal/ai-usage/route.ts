import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { recordAiUsage, type AiSystem } from "@/lib/ai-usage";
import { isKnownModel } from "@/lib/ai-pricing";

// T-135 AI費用帳簿: 全システム共通の記録受け口。
//
// POST /api/internal/ai-usage
//   認証: x-api-key ヘッダ（INTERNAL_API_KEY・既存の internal API と同一鍵）
//   用途: kyuujin / job-platform から自システムの AI 呼び出しを1コール1行で記録する。
//         portal 自身は HTTP を介さず src/lib/ai-usage.ts の recordAiUsage を直接呼ぶ。
//
// body:
//   {
//     "system": "kyuujin",                 // 必須: 'portal' | 'kyuujin' | 'job-platform'
//     "endpoint": "job-structuring",       // 必須: 処理の識別子（自由文字列）
//     "model": "gemini-2.5-flash",         // 必須: 実際に投げたモデルID
//     "inputTokens": 12345,                // 任意: 非キャッシュ入力トークン
//     "outputTokens": 678,                 // 任意
//     "cachedInputTokens": 0,              // 任意: キャッシュヒット分
//     "thinkingTokens": 0,                 // 任意: 「思考」トークン（Gemini thoughtsTokenCount）。
//                                          //       送信されなくても従来どおり記録される（後方互換）。
//                                          //       出力と同単価で estimatedCostJpy に加算される。
//     "meta": { "jobId": 123 }             // 任意: 付帯情報（何でも可）
//   }
//
// 呼び出し側の鉄則: **この API の失敗で本処理を止めないこと**（await しない or try-catch で握り潰す）。
//   費用記録が落ちても AI 機能そのものは動き続けるべき。
//
// レスポンス:
//   200 { ok: true, id, estimatedCostJpy, knownModel }  … 記録成功
//   400 { ok: false, error }                            … body 不正（記録せず）
//   401 { ok: false, error: "Unauthorized" }            … 認証NG
//   500 { ok: false, error }                            … 記録失敗（副作用なし）

export const dynamic = "force-dynamic";

const VALID_SYSTEMS: AiSystem[] = ["portal", "kyuujin", "job-platform"];

function parseCount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.round(v));
}

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const system = body.system;
  const endpoint = body.endpoint;
  const model = body.model;

  if (typeof system !== "string" || !VALID_SYSTEMS.includes(system as AiSystem)) {
    return NextResponse.json(
      { ok: false, error: `system は ${VALID_SYSTEMS.join(" / ")} のいずれか` },
      { status: 400 },
    );
  }
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    return NextResponse.json({ ok: false, error: "endpoint は必須" }, { status: 400 });
  }
  if (typeof model !== "string" || !model.trim()) {
    return NextResponse.json({ ok: false, error: "model は必須" }, { status: 400 });
  }

  const meta =
    body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? (body.meta as Record<string, unknown>)
      : null;

  const ok = await recordAiUsage({
    system: system as AiSystem,
    endpoint: endpoint.trim(),
    model: model.trim(),
    inputTokens: parseCount(body.inputTokens),
    outputTokens: parseCount(body.outputTokens),
    cachedInputTokens: parseCount(body.cachedInputTokens),
    // 後方互換: thinkingTokens を送ってこない呼び出し元は null（従来動作と同じ）。
    thinkingTokens: parseCount(body.thinkingTokens),
    meta,
  });

  if (!ok) {
    // recordAiUsage は throw しない。false = DB 書込み失敗。
    return NextResponse.json({ ok: false, error: "記録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      // 単価表に無いモデルは費用が null で記録される（呼び出し側が気付けるよう返す）
      knownModel: isKnownModel(model.trim()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

import { NextResponse } from "next/server";
import { generateWithGemini } from "@/lib/ai/gemini-client";
import { FLAG_DEFINITIONS, FILEMAKER_MAPPING_KEYS, FLAG_LIST_TSV } from "@/constants/candidate-flags";
import { buildCommonAnalysisResponseSchema } from "@/lib/ai/flag-list-schema";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, unknown> = {};

  checks.geminiApiKey = !!process.env.GEMINI_API_KEY;

  checks.flagDefinitionsCount = Object.keys(FLAG_DEFINITIONS).length;
  checks.filemakerMappingKeysCount = FILEMAKER_MAPPING_KEYS.length;
  checks.flagListTsvLength = FLAG_LIST_TSV.length;

  try {
    const schema = buildCommonAnalysisResponseSchema();
    checks.responseSchemaBuilt = true;
    checks.responseSchemaHasProperties = !!schema.properties;
  } catch (e) {
    checks.responseSchemaBuilt = false;
    checks.responseSchemaError = (e as Error).message;
  }

  try {
    const { buildCommonAnalysisPrompt } = await import("@/lib/ai/load-spec");
    const { systemInstruction } = buildCommonAnalysisPrompt("test", "test", "test");
    checks.commonAnalysisPromptLoaded = systemInstruction.length > 0;
  } catch (e) {
    checks.commonAnalysisPromptLoaded = false;
    checks.yamlLoadError = (e as Error).message;
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const pingResponse = await generateWithGemini({
        systemInstruction: "あなたは疎通確認用のbotです。",
        userPrompt: '"ok" という文字列のみをJSONで {"status": "ok"} として返してください。',
        responseMimeType: "application/json",
        maxOutputTokens: 100,
        temperature: 0.1,
      });
      checks.geminiApiPingSuccess = true;
      checks.geminiApiResponsePreview = pingResponse.substring(0, 200);
    } catch (e) {
      checks.geminiApiPingSuccess = false;
      checks.geminiApiError = (e as Error).message;
    }
  }

  return NextResponse.json({
    ok: true,
    phase: "Phase 2: Core library installed",
    timestamp: new Date().toISOString(),
    checks,
  });
}

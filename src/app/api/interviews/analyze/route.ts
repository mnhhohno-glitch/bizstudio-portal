import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWithGemini, parseJsonResponse } from "@/lib/ai/gemini-client";
import { extractTextFromPdf } from "@/lib/ai/extract-text";
import { FLAG_LIST_TSV } from "@/constants/candidate-flags";
import { buildCommonAnalysisPrompt } from "@/lib/ai/load-spec";
import {
  buildCommonAnalysisResponseSchema,
  adaptGeminiResponseToCommonAnalysis,
} from "@/lib/ai/flag-list-schema";
import type { CommonAnalysisJson } from "@/types/ai/common-analysis";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_RETRIES = 2;

function isValidCommonAnalysis(obj: unknown): obj is CommonAnalysisJson {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.extracted_facts === "object" &&
    o.extracted_facts !== null &&
    !Array.isArray(o.extracted_facts) &&
    typeof o.filemaker_mapping === "object" &&
    o.filemaker_mapping !== null &&
    !Array.isArray(o.filemaker_mapping) &&
    Array.isArray(o.missing_items)
  );
}

function normalizeCommonAnalysis(
  parsed: unknown
): CommonAnalysisJson & { thought_process?: Record<string, unknown> } {
  let o = parsed as Record<string, unknown>;
  if (
    o?.common_analysis_json &&
    typeof o.common_analysis_json === "object" &&
    o.common_analysis_json !== null
  ) {
    o = o.common_analysis_json as Record<string, unknown>;
  }

  const analysisThought = o.analysis_thought as
    | Record<string, unknown>
    | undefined;
  const legacyThoughtProcess = o.thought_process as
    | Record<string, unknown>
    | undefined;
  const thought_process =
    typeof analysisThought === "object" &&
    analysisThought !== null &&
    !Array.isArray(analysisThought)
      ? analysisThought
      : typeof legacyThoughtProcess === "object" &&
          legacyThoughtProcess !== null &&
          !Array.isArray(legacyThoughtProcess)
        ? legacyThoughtProcess
        : undefined;

  const adapted = adaptGeminiResponseToCommonAnalysis(o);

  let extracted_facts = adapted.extracted_facts;
  let work_history = extracted_facts.work_history;
  if (!Array.isArray(work_history)) {
    const raw = (extracted_facts.workHistory ??
      (extracted_facts as Record<string, unknown>).職歴 ??
      extracted_facts["work history"]) as unknown;
    work_history = Array.isArray(raw) ? raw : [];
  }
  extracted_facts.work_history = work_history;

  if (
    extracted_facts.tense === undefined &&
    (extracted_facts as Record<string, unknown>).時制 !== undefined
  ) {
    extracted_facts.tense = (extracted_facts as Record<string, unknown>)
      .時制 as string;
  }
  if (!Array.isArray(extracted_facts.reading_targets)) {
    const alt = (extracted_facts as Record<string, unknown>).読むべき内容;
    extracted_facts.reading_targets = Array.isArray(alt)
      ? (alt as string[])
      : [];
  }

  const result = {
    extracted_facts,
    filemaker_mapping: adapted.filemaker_mapping,
    missing_items: adapted.missing_items,
  } as CommonAnalysisJson & { thought_process?: Record<string, unknown> };

  if (thought_process) {
    result.thought_process = thought_process;
  }
  return result;
}

function isResignationEmpty(result: CommonAnalysisJson): boolean {
  const fm = result.filemaker_mapping as Record<string, unknown>;
  const fmVal = (key: string) => {
    const x = fm[key];
    return x != null && String(x).trim() !== "";
  };
  if (fmVal("転職時期メモ") || fmVal("転職活動期間メモ")) return false;
  const wh = result.extracted_facts?.work_history;
  if (!Array.isArray(wh)) return true;
  for (const item of wh) {
    const r = item as Record<string, unknown>;
    if (
      (r.退職理由_大 != null && String(r.退職理由_大).trim() !== "") ||
      (r.退職理由_中 != null && String(r.退職理由_中).trim() !== "") ||
      (r.退職理由_小 != null && String(r.退職理由_小).trim() !== "") ||
      (r.転職理由メモ != null && String(r.転職理由メモ).trim() !== "") ||
      (r.resignation_reason != null &&
        String(r.resignation_reason).trim() !== "")
    )
      return false;
  }
  return true;
}

function mergeResignationFromSecond(
  first: CommonAnalysisJson,
  second: CommonAnalysisJson
): void {
  const fm1 = first.filemaker_mapping as Record<string, unknown>;
  const fm2 = second.filemaker_mapping as Record<string, unknown>;
  const setIfEmpty = (key: string) => {
    const v2 = fm2[key];
    if (
      v2 != null &&
      String(v2).trim() !== "" &&
      (fm1[key] == null || String(fm1[key]).trim() === "")
    ) {
      fm1[key] = v2;
    }
  };
  setIfEmpty("転職時期メモ");
  setIfEmpty("転職活動期間メモ");
  const wh2 = second.extracted_facts?.work_history;
  const wh1 = first.extracted_facts?.work_history;
  if (
    Array.isArray(wh2) &&
    Array.isArray(wh1) &&
    wh2.length === wh1.length
  ) {
    const keys = [
      "退職理由_大",
      "退職理由_中",
      "退職理由_小",
      "転職理由メモ",
      "resignation_reason",
    ];
    for (let i = 0; i < wh1.length; i++) {
      const a = wh1[i] as Record<string, unknown>;
      const b = wh2[i] as Record<string, unknown>;
      for (const k of keys) {
        const bv = b[k];
        if (
          bv != null &&
          String(bv).trim() !== "" &&
          (a[k] == null || String(a[k]).trim() === "")
        ) {
          a[k] = bv;
        }
      }
    }
  } else if (Array.isArray(wh2) && wh2.length > 0) {
    first.extracted_facts.work_history = wh2;
  }
  if (
    second.extracted_facts?.tense != null &&
    String(second.extracted_facts.tense).trim() !== "" &&
    (first.extracted_facts.tense == null ||
      String(first.extracted_facts.tense).trim() === "")
  ) {
    first.extracted_facts.tense = second.extracted_facts.tense;
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const formData = await request.formData();
    const pdfFile = formData.get("resumePdf") as File | null;
    const transcript = formData.get("transcript") as string | null;
    const interviewFile = formData.get("interviewLog") as File | null;
    const interviewRecordId = formData.get("interviewRecordId") as
      | string
      | null;

    if (!transcript && !pdfFile && !interviewFile) {
      return NextResponse.json(
        { error: "テキストまたはPDFを入力してください" },
        { status: 400 }
      );
    }

    let pdfText = "";
    let interviewLog = "";
    const flagListText = FLAG_LIST_TSV;

    if (pdfFile?.size) {
      const buf = Buffer.from(await pdfFile.arrayBuffer());
      pdfText = await extractTextFromPdf(buf);
    }
    if (interviewFile?.size) {
      interviewLog = await interviewFile.text();
    } else if (transcript) {
      interviewLog = transcript;
    }

    const { systemInstruction, userPrompt } = buildCommonAnalysisPrompt(
      pdfText,
      interviewLog,
      flagListText,
      pdfFile?.name ?? null
    );

    const analyzeStart = Date.now();
    console.log(
      `[analyze] Input: PDF=${pdfText.length} chars, interview=${interviewLog.length} chars, prompt ~${systemInstruction.length + userPrompt.length} chars`
    );

    if (pdfText.length === 0 && pdfFile?.size) {
      console.warn("[analyze] PDF uploaded but extracted 0 characters");
    }

    const responseSchema = buildCommonAnalysisResponseSchema();
    let useSchema = true;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const raw = await generateWithGemini({
          systemInstruction,
          userPrompt,
          responseMimeType: "application/json",
          maxOutputTokens: 16384,
          temperature: 0.1,
          ...(useSchema && { responseSchema }),
        });
        const parsed = parseJsonResponse<unknown>(raw);
        const normalized = normalizeCommonAnalysis(parsed);

        if (isValidCommonAnalysis(normalized)) {
          let geminiTimeMs = Date.now() - analyzeStart;
          const workHistoryEmpty =
            !Array.isArray(normalized.extracted_facts.work_history) ||
            normalized.extracted_facts.work_history.length === 0;

          if (
            interviewLog.trim().length > 100 &&
            isResignationEmpty(normalized)
          ) {
            console.log("[analyze] Resignation empty — running 2nd pass");
            const secondPassSuffix = `

【2パス目・退職理由の再抽出】
上記の面談メモを再読し、退職理由・転職理由に該当する発話が1つでもあれば、filemaker_mapping（転職時期メモ・転職活動期間メモ等）または work_history の退職理由_大/中/小・転職理由メモに必ず反映してください。該当する発話が本当に無い場合のみ空のままにしてください。出力は同じ共通解析JSON形式で返してください。`;
            try {
              const raw2 = await generateWithGemini({
                systemInstruction,
                userPrompt: userPrompt + secondPassSuffix,
                responseMimeType: "application/json",
                maxOutputTokens: 16384,
              });
              const parsed2 = parseJsonResponse<unknown>(raw2);
              const second = normalizeCommonAnalysis(parsed2);
              if (isValidCommonAnalysis(second)) {
                mergeResignationFromSecond(normalized, second);
                geminiTimeMs = Date.now() - analyzeStart;
                console.log("[analyze] 2nd pass (resignation) merged");
              }
            } catch (e2) {
              console.warn(
                "[analyze] 2nd pass failed:",
                e2 instanceof Error ? e2.message : String(e2)
              );
            }
          }

          if (interviewLog.trim().length > 500 && workHistoryEmpty) {
            console.log(
              "[analyze] work_history empty — running 2nd pass"
            );
            const workHistoryPassSuffix = `

【2パス目・職歴の再抽出】
上記の面談メモ（とPDF）を再読し、職歴（在籍した会社・在籍期間・職種・退職理由など）を在籍順にすべて抽出してください。extracted_facts.work_history に、企業名・事業内容・在籍期間_年・在籍期間_ヶ月・職種フラグ・職種メモ・退職理由_大・退職理由_中・退職理由_小・転職理由メモ を日本語キーで必ず出力してください。1社でも言及があれば配列に含め、空配列にしないでください。出力は共通解析JSON形式（extracted_facts, filemaker_mapping, missing_items）で返し、work_history を必ず埋めてください。`;
            try {
              const rawWh = await generateWithGemini({
                systemInstruction,
                userPrompt: userPrompt + workHistoryPassSuffix,
                responseMimeType: "application/json",
                maxOutputTokens: 16384,
              });
              const parsedWh = parseJsonResponse<unknown>(rawWh);
              const normWh = normalizeCommonAnalysis(parsedWh);
              const wh = normWh.extracted_facts?.work_history;
              if (Array.isArray(wh) && wh.length > 0) {
                normalized.extracted_facts.work_history = wh;
                geminiTimeMs = Date.now() - analyzeStart;
                console.log(
                  `[analyze] 2nd pass (work_history) merged, rows=${wh.length}`
                );
              }
            } catch (eWh) {
              console.warn(
                "[analyze] work_history 2nd pass failed:",
                eWh instanceof Error ? eWh.message : String(eWh)
              );
            }
          }

          console.log(
            `[analyze] Done in ${geminiTimeMs}ms (schema=${useSchema})`
          );

          const responsePayload = {
            extracted_facts: normalized.extracted_facts,
            filemaker_mapping: normalized.filemaker_mapping,
            missing_items: normalized.missing_items,
            thought_process: normalized.thought_process,
          };

          if (interviewRecordId) {
            try {
              await prisma.interviewRecord.update({
                where: { id: interviewRecordId },
                data: {
                  aiAnalysisResult: responsePayload as object,
                  aiAnalysisAt: new Date(),
                },
              });
              console.log(
                `[analyze] Saved to InterviewRecord ${interviewRecordId}`
              );
            } catch (saveErr) {
              console.warn("[analyze] Failed to save to DB:", saveErr);
            }
          }

          return NextResponse.json({
            ...responsePayload,
            _debug: {
              pdfChars: pdfText.length,
              interviewChars: interviewLog.length,
              flagListChars: flagListText.length,
              totalPromptChars:
                systemInstruction.length + userPrompt.length,
              geminiTimeMs,
              schemaUsed: useSchema,
            },
          });
        }

        lastError = new Error("Invalid common_analysis_json structure");
        const o = parsed as Record<string, unknown>;
        console.error(
          "[analyze] Invalid structure. Keys:",
          o ? Object.keys(o).join(", ") : "null"
        );
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.error("[analyze] Attempt error:", lastError.message);

        if (useSchema && lastError.message.includes("400")) {
          console.warn(
            "[analyze] Disabling responseSchema due to API error"
          );
          useSchema = false;
        }
      }
    }

    return NextResponse.json(
      {
        error:
          lastError?.message ??
          "Failed to generate valid common_analysis_json",
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("[analyze] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

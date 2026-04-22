import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { extractTextFromPdf } from "@/lib/ai/extract-text";
import { generateWithGemini, parseJsonResponse } from "@/lib/ai/gemini-client";
import { FLAG_LIST_TSV } from "@/constants/candidate-flags";
import { buildCommonAnalysisPrompt } from "@/lib/ai/load-spec";
import {
  buildCommonAnalysisResponseSchema,
  adaptGeminiResponseToCommonAnalysis,
} from "@/lib/ai/flag-list-schema";
import {
  mapFilemakerToDetail,
} from "@/lib/interview-analyzer-mapping";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "interview-attachments";
const MAX_RETRIES = 1;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const { id: interviewId } = await params;
    console.log(`[analyze-pre-interview] Starting for interview=${interviewId}`);

    const record = await prisma.interviewRecord.findUnique({
      where: { id: interviewId },
      include: {
        attachments: true,
        candidate: { select: { candidateNumber: true } },
      },
    });
    if (!record) {
      return NextResponse.json({ error: "面談レコードが見つかりません" }, { status: 404 });
    }

    const pdfAtts = record.attachments
      .filter((a) => a.fileType === "pdf" || a.mimeType === "application/pdf")
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    if (pdfAtts.length === 0) {
      return NextResponse.json({ error: "PDFが添付されていません" }, { status: 400 });
    }

    console.log(`[analyze-pre-interview] Downloading pdf: ${pdfAtts[0].filePath}`);
    const { data: fileData, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(pdfAtts[0].filePath);
    if (dlError || !fileData) {
      console.error("[analyze-pre-interview] pdf download error:", dlError);
      return NextResponse.json({ error: "PDFのダウンロードに失敗しました" }, { status: 500 });
    }

    const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
    const pdfText = await extractTextFromPdf(pdfBuffer);
    console.log(`[analyze-pre-interview] PDF text: ${pdfText.length} chars`);

    if (!pdfText.trim()) {
      return NextResponse.json({ error: "PDFからテキストを抽出できませんでした" }, { status: 500 });
    }

    const flagListText = FLAG_LIST_TSV;
    const { systemInstruction, userPrompt } = buildCommonAnalysisPrompt(
      pdfText,
      "",
      flagListText,
      pdfAtts[0].fileName ?? null,
    );

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

        const parsed = parseJsonResponse<Record<string, unknown>>(raw);
        const adapted = adaptGeminiResponseToCommonAnalysis(parsed);
        const fmMapping = (adapted.filemaker_mapping || {}) as Record<string, unknown>;

        const { detailUpdates } = mapFilemakerToDetail(fmMapping);

        const prefPattern = /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/;
        const empty = (v: unknown) => v == null || v === "";

        function resolvePrefecture(): string {
          if (!empty(detailUpdates.desiredPrefecture)) return String(detailUpdates.desiredPrefecture);
          const area = detailUpdates.desiredArea;
          if (!area || typeof area !== "string") return "";
          const m = area.match(prefPattern);
          return m ? m[1] : "";
        }

        const existing = await prisma.interviewDetail.findUnique({
          where: { interviewRecordId: interviewId },
        });

        const REG_MAP: [string, string][] = [
          ["desiredJobType1", "regJobType1"],
          ["desiredJobType2", "regJobType2"],
          ["desiredEmploymentType", "regEmploymentType"],
          ["desiredSalaryMin", "regSalaryMin"],
        ];
        for (const [src, dst] of REG_MAP) {
          if (empty(existing?.[dst as keyof typeof existing]) && !empty(detailUpdates[src])) {
            detailUpdates[dst] = detailUpdates[src];
          }
        }
        const resolvedPref = resolvePrefecture();
        if (empty(existing?.regAreaPrefecture) && resolvedPref) {
          detailUpdates.regAreaPrefecture = resolvedPref;
        }

        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(detailUpdates)) {
          if (key.startsWith("desired") || key.startsWith("reg")) {
            filtered[key] = value;
          }
        }

        console.log(`[analyze-pre-interview] Success: ${Object.keys(filtered).length} fields`);

        return NextResponse.json({
          success: true,
          detailUpdates: filtered,
        });
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.error(`[analyze-pre-interview] Attempt ${attempt} error:`, lastError.message);
        if (useSchema && lastError.message.includes("400")) {
          useSchema = false;
        }
      }
    }

    return NextResponse.json(
      { error: `解析に失敗しました: ${lastError?.message || "Unknown"}` },
      { status: 500 },
    );
  } catch (e) {
    console.error("[analyze-pre-interview] Unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { generateWithGemini, parseJsonResponse } from "@/lib/ai/gemini-client";
import { extractTextFromPdf, extractTextFromXlsx } from "@/lib/ai/extract-text";
import { buildStructuredExtractPrompt } from "@/lib/ai/load-spec";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "interview-attachments";

export async function POST(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, attachmentId } = await params;

  const attachment = await prisma.interviewAttachment.findFirst({
    where: { id: attachmentId, interviewRecordId: id },
  });
  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 }
    );
  }

  await prisma.interviewAttachment.update({
    where: { id: attachmentId },
    data: { analysisStatus: "processing" },
  });

  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(attachment.filePath);

    if (downloadError || !fileData) {
      throw new Error(
        `Failed to download file: ${downloadError?.message ?? "no data"}`
      );
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    let extractedText = "";

    const mime = attachment.mimeType ?? "";
    const fileType = attachment.fileType.toLowerCase();

    if (mime === "application/pdf" || fileType === "pdf") {
      extractedText = await extractTextFromPdf(buffer);
    } else if (
      mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      fileType === "xlsx"
    ) {
      extractedText = await extractTextFromXlsx(buffer);
    } else if (mime.startsWith("text/") || fileType === "txt" || fileType === "csv") {
      extractedText = buffer.toString("utf-8");
    } else if (mime.startsWith("image/")) {
      extractedText = `[画像ファイル: ${attachment.fileName}]`;
    } else {
      throw new Error(`Unsupported file type for analysis: ${mime}`);
    }

    if (extractedText.trim().length === 0) {
      throw new Error("ファイルからテキストを抽出できませんでした");
    }

    const { systemInstruction, userPrompt } = buildStructuredExtractPrompt(
      extractedText,
      ""
    );

    const raw = await generateWithGemini({
      systemInstruction,
      userPrompt,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0.1,
    });

    const analysisResult = parseJsonResponse(raw);

    await prisma.interviewAttachment.update({
      where: { id: attachmentId },
      data: {
        analysisStatus: "completed",
        analysisResult: analysisResult as object,
        analyzedAt: new Date(),
        analysisError: null,
      },
    });

    return NextResponse.json({
      attachmentId,
      analysisStatus: "completed",
      analysisResult,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown analysis error";
    console.error(`[attachment-analyze] Error for ${attachmentId}:`, error);

    await prisma.interviewAttachment.update({
      where: { id: attachmentId },
      data: {
        analysisStatus: "failed",
        analysisError: errorMessage,
      },
    });

    return NextResponse.json(
      { error: errorMessage, analysisStatus: "failed" },
      { status: 500 }
    );
  }
}

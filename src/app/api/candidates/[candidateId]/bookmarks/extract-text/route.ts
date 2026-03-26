import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { google } from "googleapis";

export const maxDuration = 300; // 5 minutes

const PDF_EXTRACTOR_URL = process.env.PDF_EXTRACTOR_URL;
const BATCH_SIZE = 3;

function getDrive() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");
  }
  const credentials = JSON.parse(serviceAccountKey);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!PDF_EXTRACTOR_URL) {
    return NextResponse.json({ error: "PDF_EXTRACTOR_URL が未設定です" }, { status: 500 });
  }

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds } = body as { fileIds: string[] };

  console.log("[ExtractText] API called with fileIds:", fileIds);

  if (!fileIds?.length) {
    return NextResponse.json({ error: "fileIds is required" }, { status: 400 });
  }

  // Fetch candidate files
  const candidateFiles = await prisma.candidateFile.findMany({
    where: {
      id: { in: fileIds },
      candidateId,
      category: "BOOKMARK",
    },
  });

  // Split into already-extracted and needs-extraction
  const filesToExtract = candidateFiles.filter((f) => !f.extractedText);
  const skipped = candidateFiles.length - filesToExtract.length;
  let extracted = 0;
  let failed = 0;

  console.log(`[ExtractText] Found ${candidateFiles.length} files, ${filesToExtract.length} need extraction, ${skipped} skipped`);

  const drive = getDrive();

  // Process in batches
  for (let i = 0; i < filesToExtract.length; i += BATCH_SIZE) {
    const batch = filesToExtract.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (file) => {
        try {
          // Download PDF from Google Drive
          const driveResponse = await drive.files.get(
            { fileId: file.driveFileId, alt: "media", supportsAllDrives: true },
            { responseType: "arraybuffer" }
          );
          const pdfBuffer = Buffer.from(driveResponse.data as ArrayBuffer);

          // Send to pdf-text-extractor
          const formData = new FormData();
          const blob = new Blob([pdfBuffer], { type: "application/pdf" });
          formData.append("file", blob, file.fileName);

          const extractRes = await fetch(`${PDF_EXTRACTOR_URL}/extract-text`, {
            method: "POST",
            body: formData,
          });

          if (!extractRes.ok) {
            throw new Error(`Extractor returned ${extractRes.status}`);
          }

          const extractData = await extractRes.json();

          // Save to DB
          await prisma.candidateFile.update({
            where: { id: file.id },
            data: {
              extractedText: extractData.text || "",
              extractedAt: new Date(),
            },
          });

          extracted++;
        } catch (error) {
          console.error(`[ExtractText] Failed for ${file.fileName}:`, error);
          failed++;
        }
      })
    );
  }

  return NextResponse.json({
    extracted,
    skipped,
    failed,
    message: `${extracted}件のテキスト抽出が完了しました`,
  });
}

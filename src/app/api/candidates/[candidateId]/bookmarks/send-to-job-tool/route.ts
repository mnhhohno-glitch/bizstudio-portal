import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";

export const maxDuration = 300; // 5 minutes

const API_TIMEOUT_MS = 120000; // 2 minutes
const BATCH_UPLOAD_TIMEOUT_MS = 180000; // 3 minutes for auto-process/batch
const DOWNLOAD_BATCH_SIZE = 5; // parallel download concurrency

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds, dbType, targetAreas, memoContent } = body as {
    fileIds: string[];
    dbType: string;
    targetAreas: string[];
    memoContent?: string | null;
  };

  if (!fileIds?.length || !dbType || !targetAreas?.length) {
    return NextResponse.json({ error: "fileIds, dbType, targetAreas are required" }, { status: 400 });
  }

  const KYUUJIN_PDF_TOOL_URL = process.env.KYUUJIN_PDF_TOOL_URL;
  if (!KYUUJIN_PDF_TOOL_URL) {
    return NextResponse.json({ error: "KYUUJIN_PDF_TOOL_URL が未設定です" }, { status: 500 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      candidateNumber: true,
      name: true,
      employee: { select: { name: true } },
    },
  });

  if (!candidate) return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  if (!candidate.candidateNumber) {
    return NextResponse.json({ error: "求職者番号が設定されていません" }, { status: 400 });
  }

  const advisorName = candidate.employee?.name || "";

  try {
    // 1. Check existing project
    console.log("[SendToJobTool] Step 1: Checking existing project...", { candidateNumber: candidate.candidateNumber });
    let projectId: number;
    let processingUnitId: number;
    let recordKey: string = "";

    const existingRes = await fetchWithTimeout(
      `${KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/${candidate.candidateNumber}/jobs`
    );

    if (existingRes.ok) {
      const existingData = await existingRes.json();
      if (existingData.project_id) {
        projectId = existingData.project_id;

        const unitRes = await fetchWithTimeout(
          `${KYUUJIN_PDF_TOOL_URL}/api/projects/${projectId}/processing-units`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_areas: targetAreas }),
          }
        );
        const unitData = await unitRes.json();
        processingUnitId = unitData.id;
        recordKey = unitData.record_key || "";
      } else {
        const result = await createProject(KYUUJIN_PDF_TOOL_URL, candidate, advisorName, targetAreas, dbType);
        projectId = result.projectId;
        processingUnitId = result.processingUnitId;
        recordKey = result.recordKey;
      }
    } else if (existingRes.status === 404) {
      const result = await createProject(KYUUJIN_PDF_TOOL_URL, candidate, advisorName, targetAreas, dbType);
      projectId = result.projectId;
      processingUnitId = result.processingUnitId;
      recordKey = result.recordKey;
    } else {
      return NextResponse.json({ error: "kyuujin-pdf-toolとの通信に失敗しました" }, { status: 502 });
    }
    console.log("[SendToJobTool] Step 1 complete:", { projectId, processingUnitId });

    // 2. Download bookmark PDFs from Google Drive (parallel, batched)
    console.log("[SendToJobTool] Step 2: Downloading PDFs from Google Drive...", { fileCount: fileIds.length });
    const bookmarkFiles = await prisma.candidateFile.findMany({
      where: { id: { in: fileIds }, category: "BOOKMARK" },
    });

    const downloadedFiles: { fileName: string; buffer: Buffer; mimeType: string }[] = [];
    let failedCount = 0;

    for (let i = 0; i < bookmarkFiles.length; i += DOWNLOAD_BATCH_SIZE) {
      const batch = bookmarkFiles.slice(i, i + DOWNLOAD_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const { base64, mimeType } = await downloadFileFromDrive(file.driveFileId);
          return {
            fileName: file.fileName,
            buffer: Buffer.from(base64, "base64"),
            mimeType,
          };
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          downloadedFiles.push(result.value);
        } else {
          console.error("[SendToJobTool] Download failed:", result.reason);
          failedCount++;
        }
      }
    }

    console.log("[SendToJobTool] Step 2 complete:", { downloaded: downloadedFiles.length, failed: failedCount });

    if (downloadedFiles.length === 0) {
      return NextResponse.json({ error: "ファイルのダウンロードにすべて失敗しました" }, { status: 500 });
    }

    // 3-4. Upload and memo import (branched by dbType)
    const formData = new FormData();
    for (const file of downloadedFiles) {
      const uint8 = new Uint8Array(file.buffer);
      const blob = new Blob([uint8], { type: file.mimeType });
      formData.append("files", blob, file.fileName);
    }

    if (dbType === "circus") {
      // === Circus mode: local upload + user memo ===

      // Step 3: Upload to local storage
      console.log("[SendToJobTool] Step 3 (Circus): Uploading to local storage...", { fileCount: downloadedFiles.length });
      const uploadRes = await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/upload/projects/${projectId}/files/batch`,
        { method: "POST", body: formData },
        BATCH_UPLOAD_TIMEOUT_MS
      );

      if (!uploadRes.ok) {
        console.error("Circus upload failed:", uploadRes.status, await uploadRes.text());
        return NextResponse.json({ error: "PDFのアップロードに失敗しました" }, { status: 502 });
      }

      const uploadData = await uploadRes.json();
      console.log("[SendToJobTool] Step 3 complete (Circus):", {
        uploaded: uploadData.total_uploaded,
        failed: uploadData.total_failed,
      });

      // Step 4: Import user-provided memo
      console.log("[SendToJobTool] Step 4 (Circus): Importing user memo...");
      if (memoContent && memoContent.trim()) {
        try {
          await fetchWithTimeout(
            `${KYUUJIN_PDF_TOOL_URL}/api/projects/${projectId}/memos/import`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: memoContent,
                processing_unit_id: processingUnitId,
              }),
            }
          );
        } catch (e) {
          console.error("Circus memo import failed:", e);
        }
      }
      console.log("[SendToJobTool] Step 4 complete (Circus)");

    } else {
      // === HITO-Link/マイナビ mode: Google Drive auto-process ===

      // Step 3: Upload via auto-process/batch
      console.log("[SendToJobTool] Step 3 (HITO): Uploading to auto-process...", { fileCount: downloadedFiles.length });
      const uploadRes = await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/drive/upload/auto-process/batch`,
        { method: "POST", body: formData },
        BATCH_UPLOAD_TIMEOUT_MS
      );

      if (!uploadRes.ok) {
        console.error("Upload batch failed:", uploadRes.status, await uploadRes.text());
        return NextResponse.json({ error: "PDFのアップロードに失敗しました" }, { status: 502 });
      }

      const uploadData = await uploadRes.json();
      console.log("[SendToJobTool] Step 3 complete (HITO):", { processed: uploadData.processed?.length || 0 });

      // Step 4: Auto-generate memos from upload response
      console.log("[SendToJobTool] Step 4 (HITO): Importing auto-generated memos...");
      const processed = uploadData.processed || [];
      if (processed.length > 0) {
        const autoMemoContent = processed
          .map((p: { company_name?: string; share_url?: string }) => `${p.company_name || ""}\n${p.share_url || ""}`)
          .join("\n");

        if (autoMemoContent.trim()) {
          try {
            await fetchWithTimeout(
              `${KYUUJIN_PDF_TOOL_URL}/api/projects/${projectId}/memos/import`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: autoMemoContent,
                  processing_unit_id: processingUnitId,
                }),
              }
            );
          } catch (e) {
            console.error("Memo import failed:", e);
          }
        }
      }
      console.log("[SendToJobTool] Step 4 complete (HITO)");
    }

    // 5. Mark files received
    console.log("[SendToJobTool] Step 5: Marking files complete...");
    try {
      await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/projects/${projectId}/complete-files`,
        { method: "POST" }
      );
    } catch (e) {
      console.error("Complete files failed:", e);
    }
    console.log("[SendToJobTool] Step 5 complete");

    // 6. Start extraction (async)
    console.log("[SendToJobTool] Step 6: Starting extraction...");
    try {
      await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/extraction/projects/${projectId}/extract?processing_unit_id=${processingUnitId}`,
        { method: "POST" }
      );
    } catch (e) {
      console.error("Extraction start failed:", e);
    }
    console.log("[SendToJobTool] Step 6 complete: Extraction started");

    const memoUrl = recordKey
      ? `${KYUUJIN_PDF_TOOL_URL}/projects/${projectId}/memos?unit=${processingUnitId}&key=${recordKey}`
      : `${KYUUJIN_PDF_TOOL_URL}/projects/${projectId}/memos?unit=${processingUnitId}`;

    return NextResponse.json({
      success: true,
      projectId,
      processingUnitId,
      recordKey,
      uploadedCount: downloadedFiles.length,
      failedCount,
      projectUrl: memoUrl,
      message: `${downloadedFiles.length}件のPDFを送信し、抽出処理を開始しました`,
    });
  } catch (e) {
    console.error("Send to job tool error:", e);
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json({ error: "kyuujin-pdf-toolへの接続がタイムアウトしました" }, { status: 502 });
    }
    return NextResponse.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}

async function createProject(
  baseUrl: string,
  candidate: { name: string; candidateNumber: string | null },
  advisorName: string,
  targetAreas: string[],
  dbType: string
): Promise<{ projectId: number; processingUnitId: number; recordKey: string }> {
  const createRes = await fetchWithTimeout(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_seeker_name: candidate.name,
      job_seeker_id: candidate.candidateNumber,
      career_advisor: advisorName,
      target_areas: targetAreas,
      db_type: dbType,
      storage_type: "local",
    }),
  });

  if (createRes.status === 409) {
    const conflictData = await createRes.json();
    const projectId = conflictData.existing_project_id;
    const unitRes = await fetchWithTimeout(`${baseUrl}/api/projects/${projectId}/processing-units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_areas: targetAreas }),
    });
    const unitData = await unitRes.json();
    return { projectId, processingUnitId: unitData.id, recordKey: unitData.record_key || "" };
  }

  if (!createRes.ok) {
    throw new Error(`Project creation failed: ${createRes.status}`);
  }

  const projectData = await createRes.json();
  return { projectId: projectData.id, processingUnitId: projectData.initial_unit_id, recordKey: projectData.initial_record_key || "" };
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { extractCandidateFacingComment } from "@/lib/comment-split";

export const maxDuration = 300; // 5 minutes

const API_TIMEOUT_MS = 120000; // 2 minutes
const BATCH_UPLOAD_TIMEOUT_MS = 180000; // 3 minutes for auto-process/batch
const DOWNLOAD_BATCH_SIZE = 5; // parallel download concurrency

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function toMatchLabel(rating: string | null): string {
  switch (rating) {
    case "A": return "◎ 非常にマッチ";
    case "B": return "○ マッチ";
    case "C":
    case "D": return "△ チャレンジ求人";
    default: return "";
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds, dbType, targetAreas } = body as {
    fileIds: string[];
    dbType: string;
    targetAreas: string[];
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
    // AI評価順（A→B→C→D→未評価）でソート
    const ratingOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    const bookmarkFiles = (
      await prisma.candidateFile.findMany({
        where: { id: { in: fileIds }, category: "BOOKMARK" },
      })
    ).sort((a, b) => {
      const ra = a.aiMatchRating ? (ratingOrder[a.aiMatchRating] ?? 4) : 4;
      const rb = b.aiMatchRating ? (ratingOrder[b.aiMatchRating] ?? 4) : 4;
      if (ra !== rb) return ra - rb;
      return a.fileName.localeCompare(b.fileName);
    });

    const downloadedFiles: { fileName: string; buffer: Buffer; mimeType: string; aiMatchRating: string | null; aiAnalysisComment: string | null; driveFileId: string }[] = [];
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
            aiMatchRating: file.aiMatchRating,
            aiAnalysisComment: file.aiAnalysisComment,
            driveFileId: file.driveFileId,
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
    if (dbType === "circus") {
      // === Circus mode: local upload (memo is attached in kyuujinPDF UI) ===
      const circusFormData = new FormData();
      for (const file of downloadedFiles) {
        const uint8 = new Uint8Array(file.buffer);
        const blob = new Blob([uint8], { type: file.mimeType });
        circusFormData.append("files", blob, file.fileName);
      }

      // Step 3: Upload to local storage (original filenames)
      console.log("[SendToJobTool] Step 3 (Circus): Uploading to local storage...", { fileCount: downloadedFiles.length });
      const uploadRes = await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/upload/projects/${projectId}/files/batch`,
        { method: "POST", body: circusFormData },
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

      // Step 4: Skipped — memo is now attached directly in kyuujinPDF
      console.log("[SendToJobTool] Step 4 (Circus): Skipped (memo attached in kyuujinPDF)");

    } else {
      // === HITO-Link/マイナビ mode: Google Drive auto-process ===
      const formData = new FormData();
      for (const file of downloadedFiles) {
        const uint8 = new Uint8Array(file.buffer);
        const blob = new Blob([uint8], { type: file.mimeType });
        formData.append("files", blob, file.fileName);
      }

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

    // 5.5. Send CA comments to kyuujinPDF
    console.log("[SendToJobTool] Step 5.5: Sending CA comments...");
    try {
      const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;
      if (!KYUUJIN_API_SECRET) {
        console.warn("[SendToJobTool] Step 5.5: KYUUJIN_API_SECRET not set, skipping");
      } else {
        const comments = downloadedFiles
          .map((f) => {
            if (!f.aiAnalysisComment || !f.aiMatchRating) return null;
            const jobNumMatch = f.fileName.match(/_No(\d+)/i);
            // Circus形式は求人番号、HITO形式はdriveFileId、それ以外はfileNameで照合
            if (!jobNumMatch && !f.driveFileId && !f.fileName) return null;
            const commentBody = extractCandidateFacingComment(f.aiAnalysisComment);
            if (!commentBody) return null;
            const entry: { job_number?: string; drive_file_id?: string; file_name?: string; match_label: string; comment: string } = {
              match_label: toMatchLabel(f.aiMatchRating),
              comment: commentBody,
              file_name: f.fileName,
            };
            if (jobNumMatch) entry.job_number = jobNumMatch[1];
            if (f.driveFileId) entry.drive_file_id = f.driveFileId;
            return entry;
          })
          .filter((c): c is { job_number?: string; drive_file_id?: string; file_name?: string; match_label: string; comment: string } => c !== null);

        if (comments.length > 0) {
          const caRes = await fetchWithTimeout(
            `${KYUUJIN_PDF_TOOL_URL}/api/external/mypage/jobs/ca-comment`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "x-api-secret": KYUUJIN_API_SECRET,
              },
              body: JSON.stringify({
                job_seeker_id: candidate.candidateNumber,
                comments,
              }),
            }
          );
          const caResult = await caRes.json().catch(() => null);
          console.log("[SendToJobTool] Step 5.5 complete:", { count: comments.length, result: caResult });
        } else {
          console.log("[SendToJobTool] Step 5.5: No comments to send");
        }
      }
    } catch (e) {
      console.error("[SendToJobTool] Step 5.5 failed:", e);
    }

    // 6. Start extraction so jobs appear in the job introduction tab
    console.log("[SendToJobTool] Step 6: Starting extraction...");
    try {
      const extractRes = await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/extraction/projects/${projectId}/extract?processing_unit_id=${processingUnitId}`,
        { method: "POST" },
        BATCH_UPLOAD_TIMEOUT_MS
      );
      if (extractRes.ok) {
        const extractData = await extractRes.json();
        console.log("[SendToJobTool] Step 6 complete:", extractData);
      } else {
        console.warn("[SendToJobTool] Step 6: Extraction request failed:", extractRes.status);
      }
    } catch (e) {
      console.warn("[SendToJobTool] Step 6: Extraction failed (non-blocking):", e);
    }

    // Circus送信ではメモ帳インポート画面(-4)へ遷移させる。
    // kyuujin-pdf-tool が返す record_key はメモ編集画面(-3)を指すため、
    // Circus の場合のみ末尾を -4 に差し替える。HITO-Link/マイナビは素の recordKey を使う。
    const navigationRecordKey =
      dbType === "circus" && recordKey
        ? recordKey.replace(/-\d+$/, "-4")
        : recordKey;

    const memoUrl = navigationRecordKey
      ? `${KYUUJIN_PDF_TOOL_URL}/projects/${projectId}/memos?unit=${processingUnitId}&key=${navigationRecordKey}`
      : `${KYUUJIN_PDF_TOOL_URL}/projects/${projectId}/memos?unit=${processingUnitId}`;

    return NextResponse.json({
      success: true,
      projectId,
      processingUnitId,
      recordKey,
      uploadedCount: downloadedFiles.length,
      failedCount,
      projectUrl: memoUrl,
      message: `${downloadedFiles.length}件のPDFを送信しました。メモ一覧で引当てを確認してください`,
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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";

export const maxDuration = 300; // 5 minutes

const API_TIMEOUT_MS = 120000; // 2 minutes

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
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

        // Create new ProcessingUnit
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
        // No project — create new
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

    // 2. Download bookmark PDFs from Google Drive
    console.log("[SendToJobTool] Step 2: Downloading PDFs from Google Drive...", { fileCount: fileIds.length });
    const bookmarkFiles = await prisma.candidateFile.findMany({
      where: { id: { in: fileIds }, category: "BOOKMARK" },
    });

    // 3. Upload to kyuujin-pdf-tool
    const formData = new FormData();
    let uploadedCount = 0;
    let failedCount = 0;

    for (const file of bookmarkFiles) {
      try {
        const { base64, mimeType } = await downloadFileFromDrive(file.driveFileId);
        const buffer = Buffer.from(base64, "base64");
        const blob = new Blob([buffer], { type: mimeType });
        formData.append("files", blob, file.fileName);
        uploadedCount++;
      } catch (e) {
        console.error(`Failed to download file ${file.fileName}:`, e);
        failedCount++;
      }
    }

    console.log("[SendToJobTool] Step 2 complete:", { uploadedCount, failedCount });

    if (uploadedCount === 0) {
      return NextResponse.json({ error: "ファイルのダウンロードにすべて失敗しました" }, { status: 500 });
    }

    console.log("[SendToJobTool] Step 3: Uploading to kyuujin-pdf-tool...", { fileCount: uploadedCount });
    const uploadRes = await fetchWithTimeout(
      `${KYUUJIN_PDF_TOOL_URL}/api/drive/upload/auto-process/batch`,
      { method: "POST", body: formData }
    );

    if (!uploadRes.ok) {
      console.error("Upload batch failed:", uploadRes.status, await uploadRes.text());
      return NextResponse.json({ error: "PDFのアップロードに失敗しました" }, { status: 502 });
    }

    const uploadData = await uploadRes.json();
    console.log("[SendToJobTool] Step 3 complete - upload response:", JSON.stringify(uploadData));

    // 4. Import memos
    const processed = uploadData.processed || [];
    if (processed.length > 0) {
      const memoContent = processed
        .map((p: { company_name?: string; share_url?: string }) => `${p.company_name || ""}\n${p.share_url || ""}`)
        .join("\n");

      console.log("[SendToJobTool] Step 4: Importing memos - content:", memoContent);
      console.log("[SendToJobTool] Step 4: Importing memos - processingUnitId:", processingUnitId);

      try {
        const memoImportRes = await fetchWithTimeout(
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
        const memoImportData = await memoImportRes.json();
        console.log("[SendToJobTool] Step 4 complete:", JSON.stringify(memoImportData));
      } catch (e) {
        console.error("Memo import failed:", e);
      }
    } else {
      console.log("[SendToJobTool] Step 4: No processed files, skipping memo import");
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
      uploadedCount,
      failedCount,
      projectUrl: memoUrl,
      message: `${uploadedCount}件のPDFを送信し、抽出処理を開始しました`,
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

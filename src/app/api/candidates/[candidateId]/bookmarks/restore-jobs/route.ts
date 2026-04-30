import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

const API_TIMEOUT_MS = 15000;
const RESTORE_BATCH_SIZE = 50;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function normalizePortalFileName(fileName: string): string {
  return fileName
    .replace(/^求人票_/, "")
    .replace(/\.pdf$/i, "")
    .replace(/_\d{14,}$/, "")
    .trim();
}

function normalizeKyuujinCompanyName(name: string): string {
  return name
    .replace(/_\d{14,}$/, "")
    .trim();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds } = body as { fileIds: string[] };

  if (!fileIds?.length) {
    return NextResponse.json({ error: "fileIds is required" }, { status: 400 });
  }

  const KYUUJIN_PDF_TOOL_URL = process.env.KYUUJIN_PDF_TOOL_URL;
  const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;
  if (!KYUUJIN_PDF_TOOL_URL || !KYUUJIN_API_SECRET) {
    return NextResponse.json({ error: "KYUUJIN_PDF_TOOL_URL / KYUUJIN_API_SECRET が未設定です" }, { status: 500 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });
  if (!candidate?.candidateNumber) {
    return NextResponse.json({ error: "求職者番号が見つかりません" }, { status: 404 });
  }

  const bookmarkFiles = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, category: "BOOKMARK" },
    select: { id: true, fileName: true, lastExportedAt: true },
  });

  // kyuujinPDF から全 Job 一覧取得（feedback_status 付き）
  let externalJobs: { id: number; company_name?: string; feedback_status?: string }[] = [];
  try {
    const res = await fetchWithTimeout(
      `${KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/${candidate.candidateNumber}/jobs`
    );
    if (res.ok) {
      const data = await res.json();
      externalJobs = data.jobs || [];
    }
  } catch (e) {
    console.error("[RestoreJobs] Failed to fetch jobs:", e);
    return NextResponse.json({ error: "kyuujinPDFとの通信に失敗しました" }, { status: 502 });
  }

  const notMatched: string[] = [];
  const notExcluded: { fileName: string; status: string }[] = [];
  const restoreJobIds: number[] = [];
  const matchedFileIds: string[] = [];

  for (const file of bookmarkFiles) {
    const normalized = normalizePortalFileName(file.fileName);
    const matched = externalJobs.find(
      (job) => job.company_name && normalizeKyuujinCompanyName(job.company_name) === normalized
    );

    if (!matched) {
      notMatched.push(file.fileName);
      continue;
    }

    const status = matched.feedback_status || "UNANSWERED";
    if (status === "EXCLUDED") {
      restoreJobIds.push(matched.id);
      matchedFileIds.push(file.id);
    } else {
      notExcluded.push({ fileName: file.fileName, status });
      matchedFileIds.push(file.id);
    }
  }

  // restore API 呼び出し（バッチ分割）
  let totalRestored = 0;
  const errors: string[] = [];

  for (let i = 0; i < restoreJobIds.length; i += RESTORE_BATCH_SIZE) {
    const batch = restoreJobIds.slice(i, i + RESTORE_BATCH_SIZE);
    try {
      const res = await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/external/mypage/jobs/restore`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-secret": KYUUJIN_API_SECRET,
          },
          body: JSON.stringify({
            job_ids: batch,
            job_seeker_id: candidate.candidateNumber,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        totalRestored += data.restored ?? 0;
      } else {
        const text = await res.text().catch(() => "");
        errors.push(`restore batch failed: ${res.status} ${text.slice(0, 200)}`);
      }
    } catch (e) {
      errors.push(`restore batch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // lastExportedAt 更新（マッチした全ファイル）
  if (matchedFileIds.length > 0) {
    await prisma.candidateFile.updateMany({
      where: { id: { in: matchedFileIds } },
      data: { lastExportedAt: new Date(), lastExportedTo: "hito-link" },
    });
    try { await recalculateSubStatusIfAuto(candidateId); } catch (e) { console.error("recalculate error:", e); }
  }

  return NextResponse.json({
    success: true,
    restored: totalRestored,
    notMatched,
    notExcluded,
    errors,
  });
}

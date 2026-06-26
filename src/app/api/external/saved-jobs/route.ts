import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/external/saved-jobs
 * 求職者ブックマーク連携 段階2（保存API・inbound external）。
 * job-platform で選んだ求人を、指定した求職者の保存求人（candidate_saved_jobs）に upsert で保存する。
 * - 認証: x-api-secret（JOB_PLATFORM_API_SECRET）。
 * - 冪等: @@unique([candidateId, source, externalJobRef]) で重複時は更新（スナップショット差し替え）。
 * - 一括対応: jobs[] で 複数求人 × 1求職者 を一度に保存。単一は top-level フィールドでも可。
 * - 保存者CA は受け取らない・保存しない（確定）。
 */

type JobInput = {
  externalJobRef?: unknown;
  source?: unknown;
  jobTitle?: unknown;
  companyName?: unknown;
  jobUrl?: unknown;
  salaryText?: unknown;
  note?: unknown;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 求職者キー: candidateId（cm... の cuid）優先、無ければ candidateNumber。
  const candidateIdRaw = str(body.candidateId);
  const candidateNumberRaw = str(body.candidateNumber);
  const key = candidateIdRaw ?? candidateNumberRaw;
  if (!key) {
    return NextResponse.json({ error: "candidateNumber or candidateId is required" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findFirst({
    where: candidateIdRaw
      ? { id: candidateIdRaw }
      : key.startsWith("cm")
        ? { id: key }
        : { candidateNumber: key },
    select: { id: true, candidateNumber: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // 一括（jobs[]）優先。無ければ body 自体を単一求人として扱う。
  const defaultSource = str(body.source) ?? "job-platform";
  const rawJobs: JobInput[] = Array.isArray(body.jobs)
    ? (body.jobs as JobInput[])
    : [body as JobInput];

  let created = 0;
  let updated = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < rawJobs.length; i++) {
    const j = rawJobs[i] ?? {};
    const externalJobRef = str(j.externalJobRef);
    const jobTitle = str(j.jobTitle);
    if (!externalJobRef || !jobTitle) {
      errors.push({ index: i, error: "externalJobRef and jobTitle are required" });
      continue;
    }
    const source = str(j.source) ?? defaultSource;
    const data = {
      jobTitle,
      companyName: str(j.companyName),
      jobUrl: str(j.jobUrl),
      salaryText: str(j.salaryText),
      note: str(j.note),
    };
    try {
      const existing = await prisma.candidateSavedJob.findUnique({
        where: {
          candidateId_source_externalJobRef: { candidateId: candidate.id, source, externalJobRef },
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.candidateSavedJob.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.candidateSavedJob.create({
          data: { candidateId: candidate.id, source, externalJobRef, ...data },
        });
        created++;
      }
    } catch (e) {
      console.error("[external/saved-jobs] upsert failed:", e);
      errors.push({ index: i, error: "save failed" });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    candidateNumber: candidate.candidateNumber,
    received: rawJobs.length,
    created,
    updated, // 既存と同一求人の再保存（冪等・スナップショット更新）
    skipped: errors.length,
    errors,
  });
}

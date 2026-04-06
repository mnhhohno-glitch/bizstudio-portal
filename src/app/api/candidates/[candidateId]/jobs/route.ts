import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ candidateId: string }> };

const cleanCompanyName = (name: string) => name.replace(/_\d{14,}$/, "");

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });

  if (!candidate) {
    return NextResponse.json(
      { error: "求職者が見つかりません" },
      { status: 404 }
    );
  }

  if (!candidate.candidateNumber) {
    return NextResponse.json({ jobs: [], total_jobs: 0 });
  }

  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: "KYUUJIN_PDF_TOOL_URL is not configured" },
      { status: 500 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(
      `${baseUrl}/api/projects/by-job-seeker-id/${candidate.candidateNumber}/jobs`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ jobs: [], total_jobs: 0 });
      }
      return NextResponse.json(
        { error: `kyuujin-pdf-tool API error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Clean company names
    if (data.jobs && Array.isArray(data.jobs)) {
      data.jobs = data.jobs.map(
        (job: { company_name?: string; [key: string]: unknown }) => ({
          ...job,
          company_name: job.company_name
            ? cleanCompanyName(job.company_name)
            : job.company_name,
        })
      );

      // 非表示にされた求人をフィルタリング
      const hiddenRecords = await prisma.hiddenJobIntroduction.findMany({
        where: { candidateId },
        select: { externalJobId: true },
      });
      if (hiddenRecords.length > 0) {
        const hiddenIds = new Set(hiddenRecords.map((r) => r.externalJobId));
        data.jobs = data.jobs.filter(
          (job: { id?: number; [key: string]: unknown }) =>
            !hiddenIds.has(job.id as number)
        );
        data.total_jobs = data.jobs.length;
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json(
        { error: "kyuujin-pdf-tool APIがタイムアウトしました" },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "kyuujin-pdf-tool APIとの通信に失敗しました" },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateAge } from "@/lib/mynavi-rpa/judgment";

/**
 * GET /api/external/candidates/search
 * 求職者ブックマーク連携 段階2（求職者検索API・inbound external）。
 * job-platform のモーダル（HITO-Link風）で求職者を検索・選択するための一覧。
 * - 認証: x-api-secret（JOB_PLATFORM_API_SECRET）。
 * - 個人情報を外部に返すため、最小項目限定（id/candidateNumber/氏名/性別/年齢/担当CA名）。
 * - 検索: q=氏名部分一致 / candidateNumber=完全一致 / careerAdvisor=担当CA名部分一致。
 *
 * クエリ: ?q=&candidateNumber=&careerAdvisor=&limit=
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const candidateNumber = (sp.get("candidateNumber") ?? "").trim();
  const careerAdvisor = (sp.get("careerAdvisor") ?? "").trim();
  const limitRaw = parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const and: Record<string, unknown>[] = [];
  if (q) and.push({ name: { contains: q, mode: "insensitive" } });
  if (candidateNumber) and.push({ candidateNumber });
  if (careerAdvisor) and.push({ employee: { name: { contains: careerAdvisor, mode: "insensitive" } } });

  const rows = await prisma.candidate.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { candidateNumber: "desc" },
    take: limit,
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      gender: true,
      birthday: true,
      employee: { select: { name: true } },
    },
  });

  const candidates = rows.map((c) => ({
    id: c.id,
    candidateNumber: c.candidateNumber,
    name: c.name,
    gender: c.gender,
    age: c.birthday ? calculateAge(c.birthday) : null,
    careerAdvisor: c.employee?.name ?? null,
  }));

  return NextResponse.json({ count: candidates.length, limit, candidates });
}

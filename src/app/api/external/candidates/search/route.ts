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
  // 並べ替え: sort=lastJobAddedAt:desc のとき「最後に求人を追加した日時」の新しい順（null＝未追加は末尾）。
  // 未指定時は従来どおり candidateNumber 降順（既存連携を壊さない）。
  const sortByRecent = (sp.get("sort") ?? "").trim() === "lastJobAddedAt:desc";

  const and: Record<string, unknown>[] = [];
  if (q) and.push({ name: { contains: q, mode: "insensitive" } });
  if (candidateNumber) and.push({ candidateNumber });
  if (careerAdvisor) and.push({ employee: { name: { contains: careerAdvisor, mode: "insensitive" } } });

  // 並べ替えキー(lastJobAddedAt)は候補者単位の集計値で、DBの take 前に確定しない。
  // sort時は対象集合を広めに取得→集計→並べ替え→limitで切る（本APIは担当CA絞り込み前提で集合は小さい）。
  const fetchTake = sortByRecent ? Math.max(limit, 500) : limit;
  const rows = await prisma.candidate.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { candidateNumber: "desc" },
    take: fetchTake,
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      gender: true,
      birthday: true,
      employee: { select: { name: true } },
    },
  });

  // 各候補者の「最後に求人を追加した日時」= CandidateFile(sourceType='job-platform') の最新 created_at。
  // N+1回避: 候補者ID群に対し groupBy で max(createdAt) を1クエリ集計。該当無しは null。
  const lastByCandidate = new Map<string, Date>();
  if (rows.length > 0) {
    const grouped = await prisma.candidateFile.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: rows.map((r) => r.id) }, sourceType: "job-platform" },
      _max: { createdAt: true },
    });
    for (const g of grouped) {
      if (g._max.createdAt) lastByCandidate.set(g.candidateId, g._max.createdAt);
    }
  }

  let candidates = rows.map((c) => ({
    id: c.id,
    candidateNumber: c.candidateNumber,
    name: c.name,
    gender: c.gender,
    age: c.birthday ? calculateAge(c.birthday) : null,
    careerAdvisor: c.employee?.name ?? null,
    lastJobAddedAt: lastByCandidate.get(c.id)?.toISOString() ?? null,
  }));

  if (sortByRecent) {
    candidates.sort((a, b) => {
      const ta = a.lastJobAddedAt ? Date.parse(a.lastJobAddedAt) : -Infinity; // null は末尾
      const tb = b.lastJobAddedAt ? Date.parse(b.lastJobAddedAt) : -Infinity;
      if (tb !== ta) return tb - ta; // 新しい順
      return b.candidateNumber.localeCompare(a.candidateNumber); // 同時刻/未追加は従来順で安定化
    });
    candidates = candidates.slice(0, limit);
  }

  return NextResponse.json({ count: candidates.length, limit, candidates });
}

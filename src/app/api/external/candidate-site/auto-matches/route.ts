import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
import { FAVORITE_DTO_SELECT, toFavoriteDTO, type FavoriteDTO } from "@/lib/candidate-site-favorite-dto";

// T-189 Phase3-2a: 求職者サイト向け「新着マッチ求人」API（承認済みの自動配信求人）。
//
// GET /api/external/candidate-site/auto-matches?candidateNumber=...（または candidateId）
//   - 認証・候補者スコープ・返却 DTO は favorites API と同一方式（X-Auth-Key・ホワイトリスト DTO・toFavoriteDTO 流用）。
//   - 対象: 当該候補者の CandidateFile（category="BOOKMARK"）のうち
//       origin="auto" AND approvalStatus="APPROVED" AND archivedAt IS NULL
//     （承認ページで ✓ された行＝introducedAt 付き。favorites GET はこの行を恒久的に返さない＝Phase3-1 のガード）。
//   - favorites DTO に加えて返す項目:
//       isRead                 … candidate_activity_logs の JOB_VIEW（job_ref = externalJobRef）が1件でもあれば true
//       approvedAt             … 承認日時（= introducedAt・ISO）
//       responseStatus         … 本人の回答状態（favorites と同じ列。null=未回答）
//       candidateExcludeReason … 本人が「対象外」を選んだ理由（response-status API で保存。null=なし）
//     origin は "auto" 固定（favorites の "ca"|"candidate" とは別値。表示側の枠分けに使う）。
//   - 並び: approvedAt 降順（同時刻は autoSourcedAt 降順）。
//   - 認証失敗は 401（fail-closed）、候補者不在は 404。他候補者の行は一切返さない（candidateId で全クエリをスコープ）。

export type AutoMatchDTO = Omit<FavoriteDTO, "origin"> & {
  origin: "auto";
  isRead: boolean;
  approvedAt: string | null;
  candidateExcludeReason: string | null;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const candidate = await resolveScopedCandidate({
    candidateId: searchParams.get("candidateId"),
    candidateNumber: searchParams.get("candidateNumber"),
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const [files, applications, viewRows] = await Promise.all([
    prisma.candidateFile.findMany({
      where: {
        candidateId: candidate.id,
        category: "BOOKMARK",
        origin: "auto",
        approvalStatus: "APPROVED",
        archivedAt: null,
      },
      select: { ...FAVORITE_DTO_SELECT, candidateExcludeReason: true, autoSourcedAt: true },
      orderBy: [{ introducedAt: "desc" }, { autoSourcedAt: "desc" }],
    }),
    // 応募済み externalJobRef 一覧（favorites と同じ「応募済み」表示用）。候補者スコープ。
    prisma.candidateJobApplication.findMany({
      where: { candidateId: candidate.id },
      select: { externalJobRef: true },
    }),
    // 既読判定: 求人詳細閲覧ログ（承認ページの「未読」判定と同一の解釈）。
    prisma.$queryRaw<{ job_ref: string }[]>(Prisma.sql`
      SELECT DISTINCT job_ref FROM candidate_activity_logs
      WHERE event_type = 'JOB_VIEW' AND job_ref IS NOT NULL AND candidate_id = ${candidate.id}
    `),
  ]);
  const appliedRefs = new Set(applications.map((a) => a.externalJobRef));
  const viewed = new Set(viewRows.map((r) => r.job_ref));

  const autoMatches: AutoMatchDTO[] = files.map((f) => ({
    ...toFavoriteDTO(f, f.externalJobRef ? appliedRefs.has(f.externalJobRef) : false),
    origin: "auto",
    isRead: !!f.externalJobRef && viewed.has(f.externalJobRef),
    approvedAt: f.introducedAt ? f.introducedAt.toISOString() : null,
    candidateExcludeReason: f.candidateExcludeReason,
  }));

  return NextResponse.json({
    ok: true,
    candidateNumber: candidate.candidateNumber,
    autoMatches,
    unreadCount: autoMatches.filter((m) => !m.isRead).length,
  });
}

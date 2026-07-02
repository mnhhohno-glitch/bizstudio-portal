import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// T-128: 求職者サイト向け「応募一覧（応募日付き）」API。
// マイページタブの応募リストに応募日時を表示するための供給口。
// データは T2 で作成済みの CandidateJobApplication（appliedAt を保持）。返す口が無かっただけ。
//
// GET /api/external/candidate-site/applications?candidateNumber=... （または candidateId）
//
// - 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（全401）。T2 と同一。
// - スコープ: リクエストが指す候補者に厳密スコープ。全クエリで candidateId を条件に含める。
// - ホワイトリスト: externalJobRef・appliedAt・保存済み求人メタ(会社名/ファイル名/URL) のみ返す。
//   notifiedAt 等の内部運用情報・通知先CA情報は一切返さない。
// - 求人メタは CandidateFile(BOOKMARK) を externalJobRef で突き合わせてベストエフォートで同梱。
//   無ければ ref のみ（mypage 側が job-platform 詳細で肉付けする）。
// - 応募0件は 200 で空配列。

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// fileName（求人票_{会社名}_{10桁以上ID}.pdf / 求人票_{会社名}.pdf）から会社名をベストエフォート抽出。
// favorites ルートと同一ロジック。形式が違えば null（fileName 自体は返すので情報は落ちない）。
function parseCompanyFromFileName(fileName: string): string | null {
  const n = fileName.replace(/\.pdf$/i, "");
  const m = n.match(/^求人票_(.+?)(?:_\d{10,})?$/);
  return m ? m[1] : null;
}

type ApplicationDTO = {
  externalJobRef: string;
  appliedAt: string;
  companyName: string | null;
  fileName: string | null;
  jobUrl: string | null;
};

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

  // 応募一覧（新しい順）。候補者スコープ。ホワイトリストのフィールドのみ select。
  const applications = await prisma.candidateJobApplication.findMany({
    where: { candidateId: candidate.id },
    select: { externalJobRef: true, appliedAt: true },
    orderBy: { appliedAt: "desc" },
  });

  // 求人メタ肉付け用: 同候補者の BOOKMARK を externalJobRef で引けるようにする（候補者スコープ）。
  const refs = applications.map((a) => a.externalJobRef);
  const metaByRef = new Map<string, { fileName: string; memo: string | null }>();
  if (refs.length > 0) {
    const files = await prisma.candidateFile.findMany({
      where: {
        candidateId: candidate.id,
        category: "BOOKMARK",
        archivedAt: null,
        externalJobRef: { in: refs },
      },
      select: { externalJobRef: true, fileName: true, memo: true },
    });
    for (const f of files) {
      if (f.externalJobRef && !metaByRef.has(f.externalJobRef)) {
        metaByRef.set(f.externalJobRef, { fileName: f.fileName, memo: f.memo });
      }
    }
  }

  const items: ApplicationDTO[] = applications.map((a) => {
    const meta = metaByRef.get(a.externalJobRef);
    return {
      externalJobRef: a.externalJobRef,
      appliedAt: a.appliedAt.toISOString(),
      companyName: meta ? parseCompanyFromFileName(meta.fileName) : null,
      fileName: meta?.fileName ?? null,
      jobUrl: meta?.memo ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    candidateNumber: candidate.candidateNumber,
    applications: items,
  });
}

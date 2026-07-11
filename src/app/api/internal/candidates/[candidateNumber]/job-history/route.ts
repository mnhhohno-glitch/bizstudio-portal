import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { normalizeCompanyKey, parseCompanyFromBookmarkFileName } from "@/lib/company-name-key";

// 求職者選択モード Phase 1a: 引き当て履歴の照合API。
//
// GET /api/internal/candidates/{candidateNumber}/job-history
//   認証: x-api-key（INTERNAL_API_KEY・auto-expire / resubmit-stale と同一の内部鍵）。未設定/不一致は 401。
//   用途: job-platform のCA向け求人検索「求職者選択モード」が、検索結果の各求人に
//         引き当て履歴フラグ（応募したい/気になる/引き当て済み/対象外）と同社フラグを重ねるための突合材料。
//
// 方針:
//   - **全履歴**を返す（archivedAt の有無を問わず category="BOOKMARK" 全行）。アーカイブ済みも
//     「過去に引き当てた事実」としてフラグ表示の対象にする（archived:true を添えて呼び出し側に判断材料を渡す）。
//   - externalJobRef が null の行（未昇格PDF等）も**除外せず返す**。job-platform 側で突合できないだけで、
//     履歴としては存在するため（同社フラグ用の会社名は拾える）。
//   - 読み出しのみ・1クエリ＋整形。1候補者あたり最大数百行想定。

export const dynamic = "force-dynamic";

/** 表示フラグ判定用の1値。Phase 1 の範囲（エントリー系＝IN_SELECTION/SELECTION_ENDED は Phase 2）。 */
export type JobHistoryStatus = "APPLY" | "INTERESTED" | "INTRODUCED" | "EXCLUDED";

/**
 * responseStatus（箱A CandidateFile.responseStatus・箱B feedback_status と同一7値）→ 表示フラグ。
 *   APPLY       → "APPLY"       （応募したい）
 *   INTERESTED  → "INTERESTED"  （気になる）
 *   EXCLUDED    → "EXCLUDED"    （対象外）
 *   上記以外（null / UNANSWERED / PENDING / IN_SELECTION / SELECTION_ENDED）
 *               → "INTRODUCED"  （引き当て済み＝CAが引き当てた事実のみ。求職者の意思表示なし or Phase 2 範囲）
 * 表示優先順位（同一求人に複数行がある場合の勝ち順）: APPLY > INTERESTED > INTRODUCED > EXCLUDED
 */
function toHistoryStatus(responseStatus: string | null): JobHistoryStatus {
  if (responseStatus === "APPLY") return "APPLY";
  if (responseStatus === "INTERESTED") return "INTERESTED";
  if (responseStatus === "EXCLUDED") return "EXCLUDED";
  return "INTRODUCED";
}

/**
 * 行の会社名: CAの表示上書き（FU-13a displayOverrides.companyName）を優先し、
 * 無ければ fileName から復元（求人票_ / circus / マイナビ の3形式に対応）。
 * ※ favorites API の会社名抽出は「求人票_」形式のみの簡易版で別実装（mypage の表示挙動を変えないため据置）。
 */
function resolveCompanyName(row: { fileName: string; displayOverrides: unknown }): string | null {
  const ov = row.displayOverrides;
  if (ov && typeof ov === "object" && !Array.isArray(ov)) {
    const c = (ov as Record<string, unknown>).companyName;
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return parseCompanyFromBookmarkFileName(row.fileName);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateNumber: string }> },
) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { candidateNumber } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { candidateNumber },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      supportStatus: true,
      // 全履歴（archivedAt 問わず）。BOOKMARK のみ。
      files: {
        where: { category: "BOOKMARK" },
        select: {
          externalJobRef: true,
          kyuujinJobId: true,
          responseStatus: true,
          fileName: true,
          displayOverrides: true,
          archivedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const jobs = candidate.files.map((f) => {
    const companyName = resolveCompanyName(f);
    return {
      externalJobRef: f.externalJobRef, // job-platform の source_job_id（null あり）
      kyuujinJobId: f.kyuujinJobId, // kyuujinPDF の Job 内部ID（null あり）
      status: toHistoryStatus(f.responseStatus),
      archived: f.archivedAt !== null,
      companyName,
    };
  });

  // 同社フラグ用: 正規化済み会社名キーの一意リスト（job-platform normalizeCompanyName と同一規則）。
  const companyKeys = [
    ...new Set(
      jobs
        .map((j) => (j.companyName ? normalizeCompanyKey(j.companyName) : ""))
        .filter((k) => k.length > 0),
    ),
  ];

  return NextResponse.json(
    {
      candidate: {
        candidateNumber: candidate.candidateNumber,
        name: candidate.name,
        supportStatus: candidate.supportStatus,
      },
      jobs,
      companyKeys,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

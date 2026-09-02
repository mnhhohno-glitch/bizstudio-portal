import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";
import { runAnalyzeCollect } from "@/lib/recommend/analyze-batch-run";

// T-189 追加: 「今すぐ探す」後のAI評価の回収（画面からのポーリング受け口）。
//
// POST /api/candidates/[candidateId]/recommend-collect
//   - 認証: getSessionUser() ＋ isAutoRecommendAdmin（recommend-now と同じ）。
//   - 処理: 夜間 cron と同一の runAnalyzeCollect を、当該求職者の台帳行だけに絞って実行する。
//     まだ ended でないバッチは何もせず返る（＝ポーリングで繰り返し呼んでよい）。
//   - 返り値の pending は「その求職者の未評価の自動配信ブックマーク件数」。
//     0 になったら評価完了。画面はこれを見てポーリングを止める。
//
// レスポンス（200）: { pending, savedFiles, autoRejectedD, inFlightRows }

export const maxDuration = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!isAutoRecommendAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId } = await params;

  try {
    const result = await runAnalyzeCollect({ willExecute: true, candidateId });

    // 未評価で残っている自動配信ブックマーク（＝まだ評価待ち）の件数。
    const pending = await prisma.candidateFile.count({
      where: {
        candidateId,
        category: "BOOKMARK",
        origin: "auto",
        approvalStatus: "PENDING",
        aiAnalyzedAt: null,
        archivedAt: null,
      },
    });

    return NextResponse.json({
      pending,
      savedFiles: result.savedFiles,
      autoRejectedD: result.autoRejectedD,
      inFlightRows: result.pendingRows,
    });
  } catch (e) {
    console.error(`[recommend-collect] 失敗 candidate=${candidateId}:`, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

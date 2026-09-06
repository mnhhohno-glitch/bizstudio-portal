import { NextResponse } from "next/server";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { approveAutoFiles } from "@/lib/recommend/auto-approval-sync";

// T-189 Phase3-1: ✓承認。
//   実処理は approveAutoFiles（@/lib/recommend/auto-approval-sync）に集約している。
//   T-189 修正（2026-09-02）: 求職者詳細の ✓✗ を撤去し、承認＝ブックマークの「紹介求人へ移動」/
//   「求人出力へ送信」に統合したため、承認処理は両者で同じ関数を呼ぶ（コピーを作らない）。
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { fileIds?: unknown };
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (fileIds.length === 0) return NextResponse.json({ error: "fileIds は必須です" }, { status: 400 });

  try {
    const { approvedIds, pdfGenerated, pdfFailed } = await approveAutoFiles({ fileIds });
    console.log(
      `[admin/auto-recommend/approve] by=${auth.user.id} files=${fileIds.length} approved=${approvedIds.length} pdfOk=${pdfGenerated} pdfFailed=${pdfFailed.length}`,
    );
    return NextResponse.json({
      ok: true,
      approved: approvedIds.length,
      approvedIds,
      pdfGenerated,
      pdfFailed: pdfFailed.map((r) => ({ fileId: r.fileId, error: r.error })),
    });
  } catch (e) {
    console.error("[admin/auto-recommend/approve] failed:", e);
    return NextResponse.json({ error: "承認に失敗しました" }, { status: 500 });
  }
}

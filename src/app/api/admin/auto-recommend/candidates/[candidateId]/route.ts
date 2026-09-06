import { NextResponse } from "next/server";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { getAutoApprovalDetail } from "@/lib/recommend/auto-approval";

// T-189 Phase3-1: 自動配信の承認ページ・詳細（承認待ちカード＋公開済み＋直近の却下/期限切れ）。
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;
  const { candidateId } = await params;
  try {
    const detail = await getAutoApprovalDetail(candidateId);
    if (!detail) return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    console.error("[admin/auto-recommend/candidates] failed:", e);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

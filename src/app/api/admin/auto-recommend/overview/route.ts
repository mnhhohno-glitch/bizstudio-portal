import { NextResponse } from "next/server";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { getAutoApprovalOverview, AUTO_DAILY_CAP } from "@/lib/recommend/auto-approval";

// T-189 Phase3-1: 自動配信の承認ページ・一覧（自動配信ONの求職者全員。承認待ち0件でも出す）。
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;
  try {
    const rows = await getAutoApprovalOverview();
    return NextResponse.json({ rows, dailyCap: AUTO_DAILY_CAP });
  } catch (e) {
    console.error("[admin/auto-recommend/overview] failed:", e);
    return NextResponse.json({ error: "集計に失敗しました" }, { status: 500 });
  }
}

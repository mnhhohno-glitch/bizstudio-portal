import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    // T-189: 自動配信トグルの表示可否（判定は lib に集約。更新APIの403判定と同一）。
    autoRecommendAdmin: isAutoRecommendAdmin(user),
  });
}

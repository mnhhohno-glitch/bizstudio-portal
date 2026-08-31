import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // T-189 Phase1: おすすめ配信トグルの表示可否（試験運用）。
  //   AUTO_RECOMMEND_ADMIN_IDS はカンマ区切りの User.id または email。未設定なら誰にも表示しない。
  const autoRecommendAdminIds = (process.env.AUTO_RECOMMEND_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    autoRecommendAdmin:
      autoRecommendAdminIds.includes(user.id) || autoRecommendAdminIds.includes(user.email),
  });
}

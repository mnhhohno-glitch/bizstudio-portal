// T-189 Phase3-1: 承認ページ配下 API（/api/admin/auto-recommend/*）の共通認可。
// 未ログイン=401、ログイン済みだが AUTO_RECOMMEND_ADMIN_IDS 外=403。判定は isAutoRecommendAdmin に集約
// （トグル表示・更新APIと同一ルール）。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";

export type AutoRecommendActor = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export async function requireAutoRecommendAdmin(): Promise<
  { ok: true; user: AutoRecommendActor } | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }
  if (!isAutoRecommendAdmin(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "自動配信の管理権限がありません" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}

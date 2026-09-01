import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";
import AutoRecommendApprovalClient from "./AutoRecommendApprovalClient";

// T-189 Phase3-1: 自動配信の承認ページ。
// AUTO_RECOMMEND_ADMIN_IDS のユーザー（自動配信の管理者）だけが開ける。配下 API も同じ判定で 403。
export const dynamic = "force-dynamic";

export default async function AutoRecommendApprovalPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAutoRecommendAdmin(user)) {
    return (
      <div className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-[14px] text-[#991B1B]">
        <div className="font-semibold">このページを表示する権限がありません（自動配信の管理者のみ）。</div>
        <Link href="/admin/master" className="mt-3 inline-block text-[13px] text-[#2563EB] underline">
          求職者管理へ戻る
        </Link>
      </div>
    );
  }
  return <AutoRecommendApprovalClient />;
}

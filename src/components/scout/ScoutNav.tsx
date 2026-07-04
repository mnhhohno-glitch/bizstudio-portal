"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useScoutRole } from "@/components/scout/ScoutRoleContext";

// T-135 T-C: タブ再編。ダッシュボード｜配信枠管理｜集計 の3本。
// 「集計」は by-sent/by-applied/by-media を統合した /scout/analytics。
// 「過去データインポート」は管理者のみ末尾に追加。開封数入力はタブから撤去（ページは温存）。
const BASE_TABS = [
  { href: "/scout", label: "ダッシュボード" },
  { href: "/scout/slots", label: "配信枠管理" },
  { href: "/scout/analytics", label: "集計" },
];

const ADMIN_TABS = [{ href: "/scout/import-legacy", label: "過去データインポート" }];

export default function ScoutNav() {
  const pathname = usePathname();
  const { isAdmin } = useScoutRole();
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-[#E5E7EB] pb-0">
      {tabs.map((t) => {
        // 完全一致（startsWith を使うと /scout が全パスに一致してしまうため）
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={[
              "rounded-t-md border border-b-0 px-4 py-2 text-[13px] font-medium transition-colors",
              active
                ? "border-[#E5E7EB] bg-white text-[#2563EB]"
                : "border-transparent text-[#6B7280] hover:text-[#374151] hover:bg-[#F9FAFB]",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

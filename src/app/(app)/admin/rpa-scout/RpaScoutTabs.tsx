"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/rpa-scout", label: "状況ボード" },
  { href: "/admin/rpa-scout/calendar", label: "配信計画カレンダー" },
  { href: "/admin/rpa-scout/patterns", label: "パターン管理" },
  { href: "/admin/rpa-scout/logs", label: "変更ログ" },
  { href: "/admin/rpa-scout/dashboard", label: "ダッシュボード" },
  { href: "/admin/rpa-scout/templates", label: "テンプレート管理" },
];

export default function RpaScoutTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-4 border-b border-[#E5E7EB]">
      <nav className="flex gap-1">
        {TABS.map((t) => {
          const active =
            t.href === "/admin/rpa-scout"
              ? pathname === "/admin/rpa-scout"
              : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={[
                "px-4 py-2 text-[14px] font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-[#2563EB] text-[#2563EB]"
                  : "border-transparent text-[#6B7280] hover:text-[#374151] hover:border-[#D1D5DB]",
              ].join(" ")}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/scout", label: "ダッシュボード" },
  { href: "/scout/by-sent", label: "配信日別集計" },
  { href: "/scout/by-applied", label: "応募日別集計" },
  { href: "/scout/by-media", label: "媒体別集計" },
  { href: "/scout/slots", label: "配信枠管理" },
  { href: "/scout/open-count", label: "開封数入力" },
  { href: "/scout/import-legacy", label: "過去データインポート" },
];

export default function ScoutNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-[#E5E7EB] pb-0">
      {TABS.map((t) => {
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

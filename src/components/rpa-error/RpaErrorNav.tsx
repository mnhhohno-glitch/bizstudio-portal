"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "エラー相談", href: "/rpa-error/chat" },
  { label: "エラー一覧", href: "/rpa-error/logs" },
  { label: "既知エラー管理", href: "/rpa-error/known-errors" },
  { label: "統計", href: "/rpa-error/stats" },
];

export default function RpaErrorNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-4 flex gap-1 border-b border-[#E5E7EB]">
      {tabs.map((tab) => {
        const active = pathname === tab.href || (tab.href !== "/rpa-error/chat" && pathname.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-[14px] font-medium transition-colors ${
              active
                ? "border-b-2 border-[#2563EB] text-[#2563EB]"
                : "text-[#6B7280] hover:text-[#374151]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

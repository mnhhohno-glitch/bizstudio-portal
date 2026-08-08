"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/training", label: "教材一覧", adminOnly: false },
  { href: "/training/history", label: "回答履歴", adminOnly: false },
  { href: "/training/reflection", label: "振り返り", adminOnly: false },
  { href: "/training/work", label: "記述ワーク", adminOnly: false },
  { href: "/training/admin", label: "研修管理", adminOnly: true },
];

export default function TrainingTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <div className="mb-4 border-b border-[#E5E7EB]">
      <nav className="flex gap-1">
        {TABS.filter((t) => isAdmin || !t.adminOnly).map((t) => {
          const active =
            t.href === "/training" ? pathname === "/training" : pathname.startsWith(t.href);
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

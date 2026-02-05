"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string };

function NavItem({ href, label, icon }: Item) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={[
        "relative flex h-12 items-center gap-3 px-4 text-[14px] transition-colors",
        active ? "bg-[#EEF2FF] text-[#374151]" : "text-white/90 hover:bg-white/10",
      ].join(" ")}
    >
      {active && <span className="absolute left-0 top-0 h-full w-1 bg-[#2563EB]" />}
      <span className="text-[16px]">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const common: Item[] = [
    { href: "/", label: "ダッシュボード", icon: "🏠" },
    { href: "/systems", label: "データ管理", icon: "🗂️" },
  ];

  const admin: Item[] = [
    { href: "/admin/users", label: "ユーザー管理", icon: "👤" },
    { href: "/admin/systems", label: "システム管理", icon: "⚙️" },
    { href: "/admin/audit", label: "監査ログ", icon: "📄" },
  ];

  const support: Item[] = [
    { href: "#", label: "レポート", icon: "📊" },
    { href: "#", label: "設定", icon: "🔧" },
    { href: "#", label: "ヘルプ", icon: "❓" },
  ];

  return (
    <aside className="w-60 shrink-0 bg-[#1E3A8A] text-white">
      <div className="h-16 border-b border-white/10 px-4 flex items-center">
        <div className="text-[20px] font-bold tracking-wide text-[#2563EB]">LOGO</div>
      </div>

      <nav className="py-2">
        {common.map((it) => (
          <NavItem key={it.href} {...it} />
        ))}

        {isAdmin && (
          <>
            {admin.map((it) => (
              <NavItem key={it.href} {...it} />
            ))}
          </>
        )}

        <div className="mt-2 border-t border-white/10 pt-2">
          {support.map((it) => (
            <NavItem key={it.label} {...it} />
          ))}
        </div>
      </nav>
    </aside>
  );
}

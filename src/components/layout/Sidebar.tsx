"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string };
type ExternalItem = { href: string; label: string; icon: string };

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

function ExternalNavItem({ href, label, icon }: ExternalItem) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex h-12 items-center gap-3 px-4 text-[14px] transition-colors text-white/90 hover:bg-white/10"
    >
      <span className="text-[16px]">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-[12px] opacity-60">↗</span>
    </a>
  );
}

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  // 外部アプリケーション
  const apps: ExternalItem[] = [
    { href: "https://tender-reverence-production.up.railway.app", label: "資料生成", icon: "📝" },
    { href: "https://web-production-95808.up.railway.app", label: "求人出力", icon: "📄" },
    { href: "https://candidate-intake-production.up.railway.app", label: "面談登録", icon: "👥" },
  ];

  // 全ユーザー向けメニュー
  const common: Item[] = [
    { href: "/admin/master", label: "求職者管理", icon: "📇" },
  ];

  // 管理者専用メニュー
  const adminOnly: Item[] = [
    { href: "/admin/users", label: "社員管理", icon: "👤" },
    { href: "/admin/audit", label: "監査ログ", icon: "📄" },
  ];

  return (
    <aside className="w-60 shrink-0 bg-[#1E3A8A] text-white">
      {/* ロゴ - クリックでトップへ */}
      <Link href="/" className="h-16 bg-white px-4 flex items-center hover:bg-gray-50 transition-colors">
        <img src="/logo.png" alt="BIZSTUDIO" className="h-10 w-auto" />
      </Link>

      <nav className="py-2">
        {/* 外部アプリ */}
        <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
          アプリ
        </div>
        {apps.map((it) => (
          <ExternalNavItem key={it.href} {...it} />
        ))}

        {/* 全ユーザー向けメニュー */}
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            管理
          </div>
          {common.map((it) => (
            <NavItem key={it.href} {...it} />
          ))}
          {/* 管理者専用メニュー */}
          {isAdmin && adminOnly.map((it) => (
            <NavItem key={it.href} {...it} />
          ))}
        </div>
      </nav>
    </aside>
  );
}

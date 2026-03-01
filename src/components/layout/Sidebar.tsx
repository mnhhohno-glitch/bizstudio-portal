"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Item = { href: string; label: string; icon: string };
type AppItem = {
  href: string;
  label: string;
  icon: string;
  requiresAuth: boolean;
  appId?: string;
};

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

function AppNavItem({ href, label, icon, requiresAuth, appId }: AppItem) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    if (!requiresAuth || !appId) {
      return;
    }

    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/auth/issue-app-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_app: appId }),
      });

      if (!response.ok) {
        const err = await response.json();
        alert(err.error || "トークン取得に失敗しました");
        return;
      }

      const { token, target_url } = await response.json();
      window.open(`${target_url}?auth_token=${token}`, "_blank");
    } catch {
      alert("トークン取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <a
      href={requiresAuth ? "#" : href}
      target={requiresAuth ? undefined : "_blank"}
      rel={requiresAuth ? undefined : "noopener noreferrer"}
      onClick={handleClick}
      className={[
        "relative flex h-12 items-center gap-3 px-4 text-[14px] transition-colors text-white/90",
        loading ? "opacity-50 cursor-wait" : "hover:bg-white/10",
      ].join(" ")}
    >
      <span className="text-[16px]">{loading ? "⏳" : icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-[12px] opacity-60">↗</span>
    </a>
  );
}

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const materialCreatorUrl = process.env.NEXT_PUBLIC_MATERIAL_CREATOR_URL
    || "https://tender-reverence-production.up.railway.app";
  const jobAnalyzerUrl = process.env.NEXT_PUBLIC_JOB_ANALYZER_URL
    || "https://kyuujin-pdf-tool-production.up.railway.app";
  const candidateIntakeUrl = process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL
    || "https://candidate-intake-production.up.railway.app";
  const resumeGeneratorUrl = process.env.NEXT_PUBLIC_RESUME_GENERATOR_URL
    || "https://ai-resume-generator-production-66cb.up.railway.app";

  const apps: AppItem[] = [
    {
      href: materialCreatorUrl,
      label: "資料生成",
      icon: "📝",
      requiresAuth: true,
      appId: "material_creator",
    },
    {
      href: jobAnalyzerUrl,
      label: "求人出力",
      icon: "📄",
      requiresAuth: false,
    },
    {
      href: candidateIntakeUrl,
      label: "面談登録",
      icon: "👥",
      requiresAuth: false,
    },
    {
      href: resumeGeneratorUrl,
      label: "履歴書生成",
      icon: "📋",
      requiresAuth: true,
      appId: "ai-resume-generator",
    },
  ];

  const common: Item[] = [
    { href: "/announcements", label: "お知らせ", icon: "📢" },
    { href: "/admin/master", label: "求職者管理", icon: "📇" },
    { href: "/settings", label: "設定", icon: "⚙️" },
  ];

  const adminOnly: Item[] = [
    { href: "/admin/users", label: "社員管理", icon: "👤" },
    { href: "/admin/announcements", label: "お知らせ管理", icon: "📢" },
    { href: "/admin/audit", label: "監査ログ", icon: "📄" },
  ];

  return (
    <aside className="w-60 shrink-0 bg-[#1E3A8A] text-white">
      <Link href="/" className="h-16 bg-white px-4 flex items-center hover:bg-gray-50 transition-colors">
        <img src="/logo.png" alt="BIZSTUDIO" className="h-10 w-auto" />
      </Link>

      <nav className="py-2">
        <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
          アプリ
        </div>
        {apps.map((it) => (
          <AppNavItem key={it.href} {...it} />
        ))}

        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            管理
          </div>
          {common.map((it) => (
            <NavItem key={it.href} {...it} />
          ))}
          {isAdmin && adminOnly.map((it) => (
            <NavItem key={it.href} {...it} />
          ))}
        </div>
      </nav>
    </aside>
  );
}

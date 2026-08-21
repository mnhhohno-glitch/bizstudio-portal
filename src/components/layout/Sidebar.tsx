"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// 折りたたみ状態の保存先。既存の localStorage 利用（AnnouncementPopup 等）に合わせる
const COLLAPSE_KEY = "portal-sidebar-collapsed";

type Item = { href: string; label: string; icon: string };
type AppItem = {
  href: string;
  label: string;
  icon: string;
  requiresAuth: boolean;
  appId?: string;
};

function NavItem({ href, label, icon, collapsed }: Item & { collapsed: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      // 運用判断でサイドバーのメニューは新しいタブで開く（一覧行からの遷移は同一タブのまま）
      target="_blank"
      rel="noopener noreferrer"
      title={collapsed ? label : undefined}
      className={[
        "relative flex h-12 items-center text-[14px] transition-colors",
        collapsed ? "justify-center px-0" : "gap-3 px-4",
        active ? "bg-[#EEF2FF] text-[#374151]" : "text-white/90 hover:bg-white/10",
      ].join(" ")}
    >
      {active && <span className="absolute left-0 top-0 h-full w-1 bg-[#2563EB]" />}
      <span className="text-[16px]">{icon}</span>
      {!collapsed && <span className="font-medium">{label}</span>}
    </Link>
  );
}

function AppNavItem({ href, label, icon, requiresAuth, appId, collapsed }: AppItem & { collapsed: boolean }) {
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
      // ai-resume-generator は /auth/callback?token=xxx パターンを使用
      // 他のアプリは従来の ?auth_token=xxx パターンを維持
      const redirectUrl = appId === "ai-resume-generator"
        ? `${target_url}/auth/callback?token=${token}`
        : `${target_url}?auth_token=${token}`;
      window.open(redirectUrl, "_blank");
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
      title={collapsed ? label : undefined}
      className={[
        "relative flex h-12 items-center text-[14px] transition-colors text-white/90",
        collapsed ? "justify-center px-0" : "gap-3 px-4",
        loading ? "opacity-50 cursor-wait" : "hover:bg-white/10",
      ].join(" ")}
    >
      <span className="text-[16px]">{loading ? "⏳" : icon}</span>
      {!collapsed && (
        <>
          <span className="font-medium">{label}</span>
          <span className="ml-auto text-[12px] opacity-60">↗</span>
        </>
      )}
    </a>
  );
}

function FinanceNavItem({ collapsed }: { collapsed: boolean }) {
  const [loading, setLoading] = useState(false);
  const financeUrl = process.env.NEXT_PUBLIC_FINANCE_URL || "https://bizstudio-finance-production.up.railway.app";

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/sso-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        alert("トークン取得に失敗しました");
        return;
      }
      const { token } = await res.json();
      window.open(`${financeUrl}/api/auth/sso?token=${token}`, "_blank");
    } catch {
      alert("トークン取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      title={collapsed ? "経理管理" : undefined}
      className={[
        "relative flex h-12 w-full items-center text-[14px] transition-colors text-white/90",
        collapsed ? "justify-center px-0" : "gap-3 px-4",
        loading ? "opacity-50 cursor-wait" : "hover:bg-white/10",
      ].join(" ")}
    >
      <span className="text-[16px]">{loading ? "⏳" : "💰"}</span>
      {!collapsed && (
        <>
          <span className="font-medium">経理管理</span>
          <span className="ml-auto text-[12px] opacity-60">↗</span>
        </>
      )}
    </button>
  );
}

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  // 初期値は展開。localStorage の読み出しはマウント後に行う（SSR とのズレを避ける）
  const [collapsed, setCollapsed] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // localStorage が使えない環境では展開状態のまま
    }
  }, []);

  // 初回復元ぶんの幅アニメーションは走らせず、以降のトグルだけ滑らかにする
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // 保存できなくてもトグル自体は効かせる
      }
      return next;
    });
  };

  const jobAnalyzerUrl = process.env.NEXT_PUBLIC_JOB_ANALYZER_URL
    || "https://web-production-95808.up.railway.app";
  const resumeGeneratorUrl = process.env.NEXT_PUBLIC_RESUME_GENERATOR_URL
    || "https://ai-resume-generator-production-66cb.up.railway.app";
  // 求人検索（job-platform）。独自ドメイン移行時は環境変数で差し替え。
  const jobPlatformUrl = process.env.NEXT_PUBLIC_JOB_PLATFORM_URL
    || "https://bizstudio-job-platform.vercel.app/jobs";

  const apps: AppItem[] = [
    {
      href: jobAnalyzerUrl,
      label: "求人出力",
      icon: "📄",
      requiresAuth: false,
    },
    {
      href: jobPlatformUrl,
      label: "求人検索",
      icon: "🔍",
      requiresAuth: true,
      appId: "job_platform", // portal SSO（issue-app-token → ?auth_token= で job-platform を開く）
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
    { href: "/admin/master", label: "求職者管理", icon: "📇" },
    { href: "/admin/interviews", label: "面談管理", icon: "📝" },
    { href: "/scout", label: "スカウト運用", icon: "📡" },
    { href: "/entries", label: "エントリー管理", icon: "📋" },
    { href: "/tasks", label: "タスク管理", icon: "✅" },
    { href: "/attendance", label: "勤怠管理", icon: "🕐" },
    { href: "/announcements", label: "お知らせ", icon: "📢" },
    { href: "/documents", label: "資料一覧", icon: "📄" },
    { href: "/manuals", label: "マニュアル", icon: "📖" },
    { href: "/rpa-error/chat", label: "RPAエラー管理", icon: "🤖" },
    { href: "/admin/rpa-scout", label: "RPAスカウト管理", icon: "📨" },
    { href: "/training", label: "研修", icon: "📚" },
    { href: "/settings", label: "設定", icon: "⚙️" },
  ];

  const adminOnly: Item[] = [
    { href: "/admin/users", label: "社員管理", icon: "👤" },
    { href: "/admin/announcements", label: "お知らせ管理", icon: "📢" },
    { href: "/admin/documents", label: "資料管理", icon: "📄" },
    { href: "/admin/task-master", label: "タスクマスター", icon: "📋" },
    { href: "/admin/settings", label: "管理者設定", icon: "⚙️" },
    { href: "/admin/audit", label: "監査ログ", icon: "📄" },
  ];

  return (
    <aside
      className={[
        "shrink-0 overflow-hidden bg-[#1E3A8A] text-white",
        collapsed ? "w-16" : "w-60",
        animate ? "transition-[width] duration-200 ease-in-out" : "",
      ].join(" ")}
    >
      <Link
        href="/"
        title="ホーム"
        className={[
          "flex h-16 items-center bg-white transition-colors hover:bg-gray-50",
          collapsed ? "justify-center px-2" : "px-4",
        ].join(" ")}
      >
        {collapsed ? (
          // 折りたたみ時はロゴのしずくマーク部分だけを切り出して表示する
          <span className="block h-5 w-10 overflow-hidden">
            <img src="/logo.png" alt="BIZSTUDIO" className="h-5 w-[111px] max-w-none" />
          </span>
        ) : (
          <img src="/logo.png" alt="BIZSTUDIO" className="h-10 w-auto" />
        )}
      </Link>

      <button
        onClick={toggleCollapsed}
        title={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        aria-expanded={!collapsed}
        className={[
          "flex h-9 w-full items-center text-[14px] text-white/60 transition-colors hover:bg-white/10 hover:text-white",
          collapsed ? "justify-center" : "justify-end px-4",
        ].join(" ")}
      >
        {collapsed ? "»" : "«"}
      </button>

      <nav className="pb-2">
        {collapsed ? (
          <div className="mx-3 my-2 border-t border-white/10" />
        ) : (
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            アプリ
          </div>
        )}
        {/* portal 内の画面なので AppNavItem（外部リンク・↗）ではなく NavItem で出す */}
        <NavItem href="/transfers" label="ファイル送信" icon="🔐" collapsed={collapsed} />
        {apps.map((it) => (
          <AppNavItem key={it.href} {...it} collapsed={collapsed} />
        ))}
        <NavItem href="/schedule-urls" label="日程URL" icon="📅" collapsed={collapsed} />

        <div className="mt-2 border-t border-white/10 pt-2">
          {!collapsed && (
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
              管理
            </div>
          )}
          {common.map((it) => (
            <NavItem key={it.href} {...it} collapsed={collapsed} />
          ))}
          {isAdmin && <FinanceNavItem collapsed={collapsed} />}
          {isAdmin && adminOnly.map((it) => (
            <NavItem key={it.href} {...it} collapsed={collapsed} />
          ))}
        </div>
      </nav>
    </aside>
  );
}

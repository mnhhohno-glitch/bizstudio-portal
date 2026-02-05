import Link from "next/link";

type Item = { href: string; label: string };

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="mt-6">
      <div className="px-3 text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-2 space-y-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="block rounded-md px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
          >
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const common: Item[] = [
    { href: "/", label: "ダッシュボード" },
    { href: "/systems", label: "システム一覧" },
  ];

  const admin: Item[] = [
    { href: "/admin/users", label: "社員管理" },
    { href: "/admin/systems", label: "システム管理" },
    { href: "/admin/audit", label: "監査ログ" },
  ];

  return (
    <aside className="w-64 shrink-0 border-r bg-white text-slate-900">
      <div className="h-14 border-b px-4 flex items-center font-semibold">
        メニュー
      </div>

      <div className="p-3">
        <Section title="共通" items={common} />
        {isAdmin && <Section title="管理" items={admin} />}
      </div>
    </aside>
  );
}

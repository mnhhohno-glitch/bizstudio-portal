import Link from "next/link";

export default function TopBar({
  companyName,
  isAdmin,
}: {
  companyName: string;
  isAdmin: boolean;
}) {
  return (
    <header className="w-full border-b bg-white text-slate-900">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md border bg-white" />
          <div className="font-semibold">{companyName}</div>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              管理
            </Link>
          )}

          <form action="/api/auth/logout" method="post">
            <button
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
              type="submit"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

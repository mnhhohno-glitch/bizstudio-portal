import Link from "next/link";
import { getSessionUser } from "@/lib/auth";

export default async function DashboardPage() {
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";

  return (
    <div>
      <h1 className="text-xl font-semibold">ダッシュボード</h1>
      <p className="mt-2 text-slate-600 text-sm">
        ここが「機関システム」の入口です。今後、システムカードやお知らせを表示します。
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm font-semibold">システム一覧</div>
          <div className="mt-2 text-sm text-slate-600">
            登録されたシステムへリンクで移動します（次タスクH）。
          </div>
          <Link className="mt-3 inline-block text-sm underline" href="/systems">
            /systems へ
          </Link>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm font-semibold">ログイン情報</div>
          <div className="mt-2 text-sm text-slate-700">
            {user?.name}（{user?.email}）
          </div>
          {isAdmin && (
            <div className="mt-2 text-sm text-slate-600">
              管理者メニューが表示されています。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

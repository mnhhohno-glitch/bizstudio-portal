import Link from "next/link";
import { getSessionUser } from "@/lib/auth";

export default async function SystemsPage() {
  const user = await getSessionUser();
  return (
    <div>
      <h1 className="text-xl font-semibold">システム一覧（仮）</h1>
      <p className="mt-2 text-slate-600 text-sm">
        ここに systems テーブルのリンクを表示します（次タスクH）。
      </p>

      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="text-sm text-slate-700">
          ログイン中: <span className="font-mono">{user?.email}</span>
        </div>
        <div className="mt-3">
          <Link className="text-sm underline" href="/">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}

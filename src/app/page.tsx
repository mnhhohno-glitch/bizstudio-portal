import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">ダッシュボード（仮）</h1>
      <p className="mt-2 text-gray-600">
        ようこそ、{user.name}（{user.role}）
      </p>

      <form className="mt-6" action="/api/auth/logout" method="post">
        <button className="rounded-md border px-3 py-2 hover:bg-gray-100">
          ログアウト
        </button>
      </form>
    </main>
  );
}

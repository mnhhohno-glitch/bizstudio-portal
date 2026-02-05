import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SystemsPage() {
  const systems = await prisma.systemLink.findMany({
    where: { status: "active" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      description: true,
      url: true,
      sortOrder: true,
      status: true,
    },
  });

  return (
    <div className="bg-white text-slate-900">
      <h1 className="text-xl font-semibold">システム一覧</h1>
      <p className="mt-2 text-sm text-slate-600">
        ここから各システムに移動できます。
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {systems.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border bg-white p-4 hover:bg-slate-50"
          >
            <div className="text-sm font-semibold">{s.name}</div>
            <div className="mt-2 text-sm text-slate-600">{s.description}</div>
            <div className="mt-3 text-xs font-mono break-all text-slate-500">
              {s.url}
            </div>
          </a>
        ))}
        {systems.length === 0 && (
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-600">
            まだシステムが登録されていません。管理者は「システム管理」から追加してください。
          </div>
        )}
      </div>

      <div className="mt-6">
        <Link className="text-sm underline" href="/">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardBody } from "@/components/ui/Card";

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
    <div>
      <PageTitle>システム一覧</PageTitle>
      <PageSubtleText>
        ここから各システムに移動できます。
      </PageSubtleText>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {systems.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="block"
          >
            <Card>
              <CardBody>
                <div className="text-[15px] font-semibold text-[#374151]">{s.name}</div>
                <div className="mt-2 text-[14px] text-[#374151]/80">{s.description}</div>
                <div className="mt-3 font-mono text-[12px] break-all text-[#374151]/60">
                  {s.url}
                </div>
              </CardBody>
            </Card>
          </a>
        ))}
        {systems.length === 0 && (
          <Card>
            <CardBody>
              <span className="text-[14px] text-[#374151]/60">
                まだシステムが登録されていません。管理者は「システム管理」から追加してください。
              </span>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="mt-6">
        <Link className="text-[14px] text-[#2563EB] hover:underline" href="/">
          ← ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}

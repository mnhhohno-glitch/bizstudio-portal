import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import InviteForm from "./InviteForm";
import UserListClient from "./UserListClient";

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return (
      <div className="rounded-lg border bg-white p-6">
        <h1 className="text-xl font-semibold">403 Forbidden</h1>
        <p className="mt-2 text-slate-600 text-sm">
          このページにアクセスする権限がありません。
        </p>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: [
      { employeeNumber: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });

  const usersData = users.map((u) => {
    let manusLast4: string | null = null;
    if (u.manusApiKeyEncrypted) {
      try {
        const decrypted = decrypt(u.manusApiKeyEncrypted);
        manusLast4 = decrypted.slice(-4);
      } catch {
        manusLast4 = "****";
      }
    }
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role as string,
      status: u.status as string,
      employeeNumber: u.employeeNumber,
      lineworksId: u.lineworksId,
      manusApiKeyEncrypted: !!u.manusApiKeyEncrypted,
      manusLast4,
      manusSetAt: u.manusApiKeySetAt?.toISOString() ?? null,
    };
  });

  const activeCount = users.filter((u) => u.status === "active").length;

  return (
    <div>
      <PageTitle>社員管理</PageTitle>
      <PageSubtleText>
        現在の有効社員数: <span className="font-semibold">{activeCount}</span>
      </PageSubtleText>

      {/* 招待発行 */}
      <div className="mt-6">
        <Card>
          <CardHeader title="招待を発行" />
          <CardBody>
            <InviteForm />
          </CardBody>
        </Card>
      </div>

      {/* 社員一覧 */}
      <div className="mt-6">
        <Card>
          <CardHeader title="社員一覧" />
          <CardBody>
            <UserListClient users={usersData} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

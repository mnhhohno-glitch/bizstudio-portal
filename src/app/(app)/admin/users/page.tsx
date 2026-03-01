import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";
import InviteForm from "./InviteForm";
import UserStatusButton from "./UserStatusButton";
import ManusKeyButton from "./ManusKeyButton";

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
    orderBy: { createdAt: "desc" },
  });

  const usersWithManusInfo = users.map((u) => {
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
      ...u,
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
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>名前</Th>
                    <Th>メール</Th>
                    <Th>権限</Th>
                    <Th>Manus連携</Th>
                    <Th>状態</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {usersWithManusInfo.map((u) => (
                    <tr key={u.id}>
                      <Td>{u.name}</Td>
                      <Td><span className="font-mono">{u.email}</span></Td>
                      <Td>{u.role}</Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
                            u.manusApiKeyEncrypted
                              ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
                              : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
                          }`}
                        >
                          {u.manusApiKeyEncrypted ? "設定済み" : "未設定"}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
                            u.status === "active"
                              ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
                              : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
                          }`}
                        >
                          {u.status}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          <ManusKeyButton
                            userId={u.id}
                            userName={u.name}
                            hasKey={!!u.manusApiKeyEncrypted}
                            last4={u.manusLast4}
                            setAt={u.manusSetAt}
                          />
                          <UserStatusButton
                            userId={u.id}
                            email={u.email}
                            currentStatus={u.status}
                          />
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {usersWithManusInfo.length === 0 && (
                    <tr>
                      <Td>
                        <span className="text-[#374151]/60">社員がいません</span>
                      </Td>
                      <Td></Td>
                      <Td></Td>
                      <Td></Td>
                      <Td></Td>
                      <Td></Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

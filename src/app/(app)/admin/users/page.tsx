"use client";

import { useEffect, useMemo, useState } from "react";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  createdAt: string;
};

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);

  // 招待フォーム
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const activeCount = useMemo(
    () => users.filter((u) => u.status === "active").length,
    [users]
  );

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "取得に失敗しました");
      setUsers(data.users ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "取得に失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(null);
    setInviteResult(null);
    setInviteBusy(true);

    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, name: inviteName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteErr(data?.error ?? "招待発行に失敗しました");
        return;
      }
      const inviteUrl = data.inviteUrl as string;
      const full = inviteUrl.startsWith("http")
        ? inviteUrl
        : `${window.location.origin}${inviteUrl}`;
      setInviteResult(full);
      setInviteEmail("");
      setInviteName("");
    } catch {
      setInviteErr("通信に失敗しました");
    } finally {
      setInviteBusy(false);
    }
  }

  async function toggleStatus(user: UserRow) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    const ok = window.confirm(
      `${user.email} を ${nextStatus === "disabled" ? "無効化" : "有効化"} しますか？`
    );
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "更新に失敗しました");
        return;
      }
      await fetchUsers();
    } catch {
      alert("通信に失敗しました");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert("コピーしました");
    } catch {
      alert("コピーに失敗しました（手動でコピーしてください）");
    }
  }

  return (
    <div>
      <PageTitle>ユーザー管理</PageTitle>
      <PageSubtleText>
        現在の有効ユーザー数: <span className="font-semibold">{activeCount}</span>
      </PageSubtleText>

      {/* 招待発行 */}
      <div className="mt-6">
        <Card>
          <CardHeader title="招待を発行" />
          <CardBody>
            <form className="grid gap-4 md:grid-cols-3" onSubmit={createInvite}>
              <div className="md:col-span-1">
                <label className="text-[12px] text-[#374151]/80">名前</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-[12px] text-[#374151]/80">メール</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  type="email"
                />
              </div>

              <div className="md:col-span-3 flex items-center gap-3">
                <button
                  className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                  type="submit"
                  disabled={inviteBusy}
                >
                  {inviteBusy ? "発行中..." : "招待URLを発行"}
                </button>
                {inviteErr && <div className="text-[14px] text-[#DC2626]">{inviteErr}</div>}
              </div>
            </form>

            {inviteResult && (
              <div className="mt-4 rounded-md border border-[#E5E7EB] bg-[#F5F7FA] p-3">
                <div className="text-[12px] text-[#374151]/80">招待URL（このURLを本人に送る）</div>
                <div className="mt-1 break-all font-mono text-[14px]">{inviteResult}</div>
                <button
                  className="mt-3 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                  onClick={() => copy(inviteResult)}
                >
                  コピー
                </button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* 社員一覧 */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="社員一覧"
            right={
              <button
                className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                onClick={fetchUsers}
                disabled={loading}
              >
                {loading ? "更新中..." : "更新"}
              </button>
            }
          />
          <CardBody>
            {error && <div className="mb-3 text-[14px] text-[#DC2626]">{error}</div>}

            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>名前</Th>
                    <Th>メール</Th>
                    <Th>権限</Th>
                    <Th>状態</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <Td>{u.name}</Td>
                      <Td><span className="font-mono">{u.email}</span></Td>
                      <Td>{u.role}</Td>
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
                        <button
                          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#F5F7FA]"
                          onClick={() => toggleStatus(u)}
                        >
                          {u.status === "active" ? "無効化" : "有効化"}
                        </button>
                      </Td>
                    </tr>
                  ))}
                  {!loading && users.length === 0 && (
                    <tr>
                      <Td>
                        <span className="text-[#374151]/60">ユーザーがいません</span>
                      </Td>
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

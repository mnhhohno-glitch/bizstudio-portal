"use client";

import { useEffect, useMemo, useState } from "react";

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
      // 画面で踏めるようにフルURL化（ローカル用）
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
    <div className="bg-white text-slate-900">
      <h1 className="text-xl font-semibold">社員管理</h1>
      <p className="mt-2 text-sm text-slate-600">
        現在の有効ユーザー数: <span className="font-semibold">{activeCount}</span>
      </p>

      {/* 招待発行 */}
      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="text-sm font-semibold">招待を発行</div>
        <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={createInvite}>
          <div className="md:col-span-1">
            <label className="text-xs text-slate-600">名前</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-600">メール</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              type="email"
            />
          </div>

          <div className="md:col-span-3 flex items-center gap-2">
            <button
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              type="submit"
              disabled={inviteBusy}
            >
              {inviteBusy ? "発行中..." : "招待URLを発行"}
            </button>
            {inviteErr && <div className="text-sm text-red-600">{inviteErr}</div>}
          </div>
        </form>

        {inviteResult && (
          <div className="mt-4 rounded-md border bg-white p-3">
            <div className="text-xs text-slate-600">招待URL（このURLを本人に送る）</div>
            <div className="mt-1 break-all font-mono text-sm">{inviteResult}</div>
            <button
              className="mt-3 rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              onClick={() => copy(inviteResult)}
            >
              コピー
            </button>
          </div>
        )}
      </div>

      {/* 社員一覧 */}
      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">社員一覧</div>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
            onClick={fetchUsers}
            disabled={loading}
          >
            {loading ? "更新中..." : "更新"}
          </button>
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">名前</th>
                <th className="py-2 text-left">メール</th>
                <th className="py-2 text-left">権限</th>
                <th className="py-2 text-left">状態</th>
                <th className="py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.name}</td>
                  <td className="py-2 font-mono">{u.email}</td>
                  <td className="py-2">{u.role}</td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        u.status === "active"
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-slate-300 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="py-2">
                    <button
                      className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-50"
                      onClick={() => toggleStatus(u)}
                    >
                      {u.status === "active" ? "無効化" : "有効化"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr>
                  <td className="py-4 text-slate-600" colSpan={5}>
                    ユーザーがいません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

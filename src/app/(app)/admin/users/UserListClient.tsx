"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";
import ManusKeyButton from "./ManusKeyButton";
import UserStatusButton from "./UserStatusButton";

type UserData = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  employeeNumber: number | null;
  lineworksId: string | null;
  manusApiKeyEncrypted: boolean;
  manusLast4: string | null;
  manusSetAt: string | null;
};

type EditForm = {
  name: string;
  email: string;
  employeeNumber: string;
  role: string;
  lineworksId: string;
};

export default function UserListClient({ users }: { users: UserData[] }) {
  const router = useRouter();
  const [showDisabled, setShowDisabled] = useState(false);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Edit modal
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", email: "", employeeNumber: "", role: "member", lineworksId: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = showDisabled ? users : users.filter((u) => u.status === "active");
    return [...list].sort((a, b) => {
      // nulls always last
      if (a.employeeNumber == null && b.employeeNumber == null) return 0;
      if (a.employeeNumber == null) return 1;
      if (b.employeeNumber == null) return -1;
      return sortOrder === "asc"
        ? a.employeeNumber - b.employeeNumber
        : b.employeeNumber - a.employeeNumber;
    });
  }, [users, showDisabled, sortOrder]);

  const toggleSort = () => setSortOrder((o) => (o === "asc" ? "desc" : "asc"));

  const openEdit = (u: UserData) => {
    setEditUserId(u.id);
    setEditForm({
      name: u.name,
      email: u.email,
      employeeNumber: u.employeeNumber != null ? String(u.employeeNumber) : "",
      role: u.role,
      lineworksId: u.lineworksId ?? "",
    });
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editUserId || !editForm.name.trim() || !editForm.email.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/users/${editUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          email: editForm.email,
          employeeNumber: editForm.employeeNumber || null,
          role: editForm.role,
          lineworksId: editForm.lineworksId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error || "更新に失敗しました");
        return;
      }
      setEditUserId(null);
      router.refresh();
    } catch {
      setEditError("更新に失敗しました");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
            className="h-4 w-4 accent-[#2563EB]"
          />
          無効な社員を表示
        </label>
      </div>

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>
                <button
                  type="button"
                  onClick={toggleSort}
                  className="flex items-center gap-1 cursor-pointer hover:text-[#374151]"
                >
                  社員番号
                  <span className="inline-flex flex-col text-[9px] leading-[10px]">
                    <span className={sortOrder === "asc" ? "text-[#374151]" : "text-[#D1D5DB]"}>▲</span>
                    <span className={sortOrder === "desc" ? "text-[#374151]" : "text-[#D1D5DB]"}>▼</span>
                  </span>
                </button>
              </Th>
              <Th>名前</Th>
              <Th>メール</Th>
              <Th>権限</Th>
              <Th>LINE WORKS ID</Th>
              <Th>Manus連携</Th>
              <Th>状態</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={u.status === "disabled" ? "opacity-50" : ""}>
                <Td>
                  <span className="font-mono text-[13px]">
                    {u.employeeNumber != null ? `${u.employeeNumber}` : <span className="text-[#9CA3AF]">-</span>}
                  </span>
                </Td>
                <Td>{u.name}</Td>
                <Td><span className="font-mono">{u.email}</span></Td>
                <Td>{u.role}</Td>
                <Td>
                  <span className="font-mono text-xs">
                    {u.lineworksId || <span className="text-[#6B7280]/60">未設定</span>}
                  </span>
                </Td>
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
                    <button
                      onClick={() => openEdit(u)}
                      className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    >
                      編集
                    </button>
                    <ManusKeyButton
                      userId={u.id}
                      userName={u.name}
                      hasKey={u.manusApiKeyEncrypted}
                      last4={u.manusLast4}
                      setAt={u.manusSetAt}
                    />
                    <UserStatusButton
                      userId={u.id}
                      email={u.email}
                      currentStatus={u.status as "active" | "disabled"}
                    />
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <Td><span className="text-[#374151]/60">社員がいません</span></Td>
                <Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td>
              </tr>
            )}
          </tbody>
        </Table>
      </TableWrap>

      {/* 編集モーダル */}
      {editUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">社員情報を編集</h3>

            {editError && (
              <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                {editError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">名前</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">メール</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">社員番号</label>
                <input
                  type="number"
                  value={editForm.employeeNumber}
                  onChange={(e) => setEditForm({ ...editForm, employeeNumber: e.target.value })}
                  placeholder="例: 1000001"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">権限</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">LINE WORKS ID</label>
                <input
                  type="text"
                  value={editForm.lineworksId}
                  onChange={(e) => setEditForm({ ...editForm, lineworksId: e.target.value })}
                  placeholder="例: username@bizstudio.co.jp"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditUserId(null)}
                className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={editSaving || !editForm.name.trim() || !editForm.email.trim()}
                onClick={handleEditSave}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {editSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

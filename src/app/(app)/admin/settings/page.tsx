"use client";

import { useEffect, useState } from "react";

type Employee = {
  id: string;
  name: string;
  user: { id: string; name: string } | null;
};

export default function AdminSettingsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [empRes, settingRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/admin/settings"),
        ]);
        if (empRes.ok) {
          const empData = await empRes.json();
          // admin/users returns users with employee relation
          const users = empData.users || empData;
          setEmployees(
            Array.isArray(users)
              ? users.map((u: { id: string; name: string; employee?: { id: string } }) => ({
                  id: u.employee?.id ?? u.id,
                  name: u.name,
                  user: { id: u.id, name: u.name },
                }))
              : []
          );
        }
        if (settingRes.ok) {
          const settingData = await settingRes.json();
          setSelectedUserId(settingData.value || "");
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "default_mynavi_assignee_id",
          value: selectedUserId,
        }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "保存しました" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "保存に失敗しました" });
      }
    } catch {
      setMessage({ type: "error", text: "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-[14px] text-[#6B7280]">読み込み中...</span>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-[#374151]">管理者設定</h1>
      <p className="mt-1 text-[13px] text-[#6B7280]">
        システム全体の設定を管理します
      </p>

      <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-6">
        <h2 className="text-[16px] font-semibold text-[#374151]">
          マイナビ新規応募者のデフォルト担当者
        </h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          マイナビスカウトからの新規応募者にタスクを自動生成する際の担当者を設定します
        </p>

        <div className="mt-4 max-w-md">
          <label className="block text-[13px] font-medium text-[#374151]">
            担当者
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          >
            <option value="">選択してください</option>
            {employees.map((emp) => (
              <option key={emp.user?.id ?? emp.id} value={emp.user?.id ?? emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>

        {message && (
          <div
            className={`mt-3 rounded-md px-3 py-2 text-[13px] ${
              message.type === "success"
                ? "bg-[#DCFCE7] text-[#16A34A]"
                : "bg-[#FEE2E2] text-[#DC2626]"
            }`}
          >
            {message.text}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !selectedUserId}
          className="mt-4 rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

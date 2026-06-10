"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// T-096 追補3 Task 5: ヘッダー直下のアカウント設定行。
// 一覧編集モーダルで編集できる項目のうち詳細画面に無いものをここで編集可能にする。
// 保存先は既存API: PATCH /api/admin/users/[id]（email/role/lineworksId/jobCategory）と
// PATCH /api/admin/users/[id]/mynavi-assignee（マイナビ担当トグル）。新APIは作らない。

type JobCategory = "" | "CA" | "MARKETING" | "OFFICE_AND_MGMT";

const UNDERLINE =
  "w-full border-0 border-b border-gray-300 rounded-none px-0 py-1 text-[13px] bg-transparent focus:ring-0 focus:border-blue-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function AccountSettingsBar({
  userId,
  email,
  role,
  jobCategory,
  lineworksId,
  isMynaviAssignee,
  hasEmployee,
}: {
  userId: string;
  email: string;
  role: string;
  jobCategory: string | null;
  lineworksId: string | null;
  isMynaviAssignee: boolean;
  hasEmployee: boolean;
}) {
  const router = useRouter();
  const initial = {
    email,
    role: role === "admin" ? "admin" : "member",
    jobCategory: (jobCategory ?? "") as JobCategory,
    lineworksId: lineworksId ?? "",
    isMynaviAssignee,
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // 1) アカウント基本項目（職種は Employee リンク時のみ送る: 未リンクは API が 400 を返す）
      const body: Record<string, unknown> = {
        email: form.email,
        role: form.role,
        lineworksId: form.lineworksId || null,
      };
      if (hasEmployee) {
        body.jobCategory = form.jobCategory === "" ? null : form.jobCategory;
      }
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `エラー ${res.status}`);
      }

      // 2) マイナビ担当（変更時のみ既存トグルAPIを呼ぶ）
      if (form.isMynaviAssignee !== initial.isMynaviAssignee) {
        const r2 = await fetch(`/api/admin/users/${userId}/mynavi-assignee`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isMynaviAssignee: form.isMynaviAssignee }),
        });
        if (!r2.ok) {
          const j = await r2.json().catch(() => ({}));
          throw new Error(j.error || `マイナビ担当の更新に失敗 ${r2.status}`);
        }
      }

      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/40">
      <div className="flex items-end gap-x-5 gap-y-2 flex-wrap">
        <div className="w-56">
          <Field label="メールアドレス">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={UNDERLINE}
            />
          </Field>
        </div>
        <div className="w-28">
          <Field label="権限">
            <select
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
              className={UNDERLINE}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </Field>
        </div>
        <div className="w-32">
          <Field label="職種">
            <select
              value={form.jobCategory}
              onChange={(e) => set("jobCategory", e.target.value as JobCategory)}
              disabled={!hasEmployee}
              className={UNDERLINE}
            >
              <option value="">未設定</option>
              <option value="CA">CA</option>
              <option value="MARKETING">マーケ</option>
              <option value="OFFICE_AND_MGMT">事務・管理</option>
            </select>
          </Field>
          {!hasEmployee && (
            <p className="mt-0.5 text-[9px] text-gray-400">社員情報の作成後に設定可</p>
          )}
        </div>
        <div className="w-52">
          <Field label="LINE WORKS ID">
            <input
              type="text"
              value={form.lineworksId}
              onChange={(e) => set("lineworksId", e.target.value)}
              placeholder="例: username@bizstudio.co.jp"
              className={UNDERLINE}
            />
          </Field>
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-1">マイナビ担当</label>
          <button
            type="button"
            onClick={() => set("isMynaviAssignee", !form.isMynaviAssignee)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              form.isMynaviAssignee ? "bg-[#2563EB]" : "bg-[#D1D5DB]"
            }`}
            aria-pressed={form.isMynaviAssignee}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                form.isMynaviAssignee ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3 pb-0.5">
          {saved && <span className="text-[12px] text-green-600">保存しました</span>}
          {error && <span className="text-[12px] text-red-600">{error}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded bg-blue-700 px-3.5 py-1 text-[12px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

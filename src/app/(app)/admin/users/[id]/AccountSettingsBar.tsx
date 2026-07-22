"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAutoSave, AutoSaveIndicator } from "./detail-ui";

// T-096 追補3 Task 5: ヘッダー直下のアカウント設定行（自動保存化）。
// 保存先は既存API:
//  - PATCH /api/admin/users/[id]（email/role/lineworksId/jobCategory）
//  - PATCH /api/admin/users/[id]/mynavi-assignee（マイナビ担当トグル）
// テキスト/セレクトは onBlur/onChange で個別 PATCH、トグルは onChange で即 PATCH。

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

  // アカウント基本項目の自動保存: PATCH /api/admin/users/[id]。
  // 職種は Employee リンク時のみ送る（未リンクは API が 400 を返す）。
  const accountAutoSave = useAutoSave(async (field, value) => {
    if (field === "jobCategory" && !hasEmployee) return; // 未リンク時は送らない
    const payload: Record<string, unknown> =
      field === "jobCategory"
        ? { jobCategory: value === "" ? null : value }
        : field === "lineworksId"
        ? { lineworksId: (value as string) || null }
        : { [field]: value };
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `エラー ${res.status}`);
    }
    router.refresh();
  }, {
    email: initial.email,
    role: initial.role,
    jobCategory: initial.jobCategory,
    lineworksId: initial.lineworksId,
  });

  // マイナビ担当のトグルは別 API（/mynavi-assignee）。
  const mynaviAutoSave = useAutoSave(async (_field, value) => {
    const res = await fetch(`/api/admin/users/${userId}/mynavi-assignee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isMynaviAssignee: Boolean(value) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `マイナビ担当の更新に失敗 ${res.status}`);
    }
    router.refresh();
  }, { isMynaviAssignee: initial.isMynaviAssignee });

  const set = <K extends keyof typeof form>(key: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: v }));
  };

  const toggleMynavi = () => {
    const next = !form.isMynaviAssignee;
    set("isMynaviAssignee", next);
    mynaviAutoSave.save("isMynaviAssignee", next);
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
              onBlur={() => accountAutoSave.save("email", form.email)}
              className={UNDERLINE}
            />
          </Field>
        </div>
        <div className="w-28">
          <Field label="権限">
            <select
              value={form.role}
              onChange={(e) => {
                const v = e.target.value;
                set("role", v);
                accountAutoSave.save("role", v);
              }}
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
              onChange={(e) => {
                const v = e.target.value as JobCategory;
                set("jobCategory", v);
                accountAutoSave.save("jobCategory", v);
              }}
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
              onBlur={() => accountAutoSave.save("lineworksId", form.lineworksId)}
              placeholder="例: username@bizstudio.co.jp"
              className={UNDERLINE}
            />
          </Field>
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-1">マイナビ担当</label>
          <button
            type="button"
            onClick={toggleMynavi}
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
          <AutoSaveIndicator status={accountAutoSave.status} error={accountAutoSave.error} />
          <AutoSaveIndicator status={mynaviAutoSave.status} error={mynaviAutoSave.error} />
        </div>
      </div>
    </div>
  );
}

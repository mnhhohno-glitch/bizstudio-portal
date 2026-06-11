"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InsuranceData, DependentData } from "./detail-types";
import { patchEmployeeSection } from "./detail-types";
import { FormField, TextInput, DateInput, NumberInput, TextArea, SaveBar, BlockTitle, ResumeAiButton } from "./detail-ui";
import { useResumeAiFill } from "./useResumeAiFill";

// T-098: 社会保険タブで AI から仮入力するのは番号類のみ。
const INSURANCE_AI_KEYS = ["pensionNumber", "employmentInsuranceNumber"] as const;

// T-096 タブ3: 社会保険（雇用保険・社会保険・扶養の3ブロック）＋扶養家族 1:N

export default function InsuranceTab({
  employeeId,
  insurance,
  dependents,
}: {
  employeeId: string;
  insurance: InsuranceData | null;
  dependents: DependentData[];
}) {
  const router = useRouter();
  const initial = {
    employmentInsuranceStatus: insurance?.employmentInsuranceStatus ?? "",
    employmentInsuranceAcquiredDate: insurance?.employmentInsuranceAcquiredDate ?? "",
    employmentInsuranceLostDate: insurance?.employmentInsuranceLostDate ?? "",
    employmentInsuranceArea: insurance?.employmentInsuranceArea ?? "",
    employmentInsuranceNumber: insurance?.employmentInsuranceNumber ?? "",
    separationNoticeRequestDate: insurance?.separationNoticeRequestDate ?? "",
    socialInsuranceStatus: insurance?.socialInsuranceStatus ?? "",
    socialInsuranceAcquiredDate: insurance?.socialInsuranceAcquiredDate ?? "",
    socialInsuranceLostDate: insurance?.socialInsuranceLostDate ?? "",
    pensionNumber: insurance?.pensionNumber ?? "",
    socialInsuranceNote: insurance?.socialInsuranceNote ?? "",
    dependentAcquiredDate: insurance?.dependentAcquiredDate ?? "",
    dependentLostDate: insurance?.dependentLostDate ?? "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  // T-098: 履歴書AI読み取り（空欄のみマージ）— 番号類だけ反映
  const ai = useResumeAiFill(employeeId, setForm, INSURANCE_AI_KEYS);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patchEmployeeSection(employeeId, "insurance", form);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(initial);
    setSaved(false);
    setError(null);
    router.refresh();
  };

  return (
    <div className="px-5 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <BlockTitle>雇用保険</BlockTitle>
        <ResumeAiButton {...ai} />
      </div>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="加入状況">
          <TextInput value={form.employmentInsuranceStatus} onChange={set("employmentInsuranceStatus")} placeholder="例: 加入" />
        </FormField>
        <FormField label="資格取得日">
          <DateInput value={form.employmentInsuranceAcquiredDate} onChange={set("employmentInsuranceAcquiredDate")} />
        </FormField>
        <FormField label="資格喪失日">
          <DateInput value={form.employmentInsuranceLostDate} onChange={set("employmentInsuranceLostDate")} />
        </FormField>
        <FormField label="管轄">
          <TextInput value={form.employmentInsuranceArea} onChange={set("employmentInsuranceArea")} />
        </FormField>
        <FormField label="被保険者番号">
          <TextInput value={form.employmentInsuranceNumber} onChange={set("employmentInsuranceNumber")} />
        </FormField>
        <FormField label="離職票依頼日">
          <DateInput value={form.separationNoticeRequestDate} onChange={set("separationNoticeRequestDate")} />
        </FormField>
      </div>

      <div className="mt-5">
        <BlockTitle>社会保険</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="加入状況">
            <TextInput value={form.socialInsuranceStatus} onChange={set("socialInsuranceStatus")} placeholder="例: 加入" />
          </FormField>
          <FormField label="資格取得日">
            <DateInput value={form.socialInsuranceAcquiredDate} onChange={set("socialInsuranceAcquiredDate")} />
          </FormField>
          <FormField label="資格喪失日">
            <DateInput value={form.socialInsuranceLostDate} onChange={set("socialInsuranceLostDate")} />
          </FormField>
          <FormField label="基礎年金番号">
            <TextInput value={form.pensionNumber} onChange={set("pensionNumber")} />
          </FormField>
          <div className="col-span-4">
            <FormField label="備考">
              <TextArea value={form.socialInsuranceNote} onChange={set("socialInsuranceNote")} />
            </FormField>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <BlockTitle>扶養</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="扶養取得日">
            <DateInput value={form.dependentAcquiredDate} onChange={set("dependentAcquiredDate")} />
          </FormField>
          <FormField label="扶養喪失日">
            <DateInput value={form.dependentLostDate} onChange={set("dependentLostDate")} />
          </FormField>
        </div>
      </div>

      <SaveBar saving={saving} error={error} saved={saved} onSave={handleSave} onCancel={handleCancel} />

      <DependentsSection employeeId={employeeId} dependents={dependents} />
    </div>
  );
}

// ---- 扶養家族（1:N）----

function DependentsSection({
  employeeId,
  dependents,
}: {
  employeeId: string;
  dependents: DependentData[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const handleAdd = async () => {
    setAdding(true);
    setListError(null);
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/dependents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setListError(j.error || `エラー ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setListError("通信エラーが発生しました");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <BlockTitle>扶養家族</BlockTitle>
        <button
          type="button"
          disabled={adding}
          onClick={handleAdd}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-slate-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {adding ? "追加中..." : "＋ 行を追加"}
        </button>
      </div>
      {listError && (
        <div className="mb-3 rounded bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
          {listError}
        </div>
      )}
      {dependents.length === 0 ? (
        <p className="text-sm text-gray-400">扶養家族は登録されていません。</p>
      ) : (
        <div className="space-y-5">
          {dependents.map((dep, i) => (
            <DependentRow key={dep.id} employeeId={employeeId} dependent={dep} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function DependentRow({
  employeeId,
  dependent,
  index,
}: {
  employeeId: string;
  dependent: DependentData;
  index: number;
}) {
  const router = useRouter();
  const initial = {
    name: dependent.name ?? "",
    kana: dependent.kana ?? "",
    gender: dependent.gender ?? "",
    relation: dependent.relation ?? "",
    birthday: dependent.birthday ?? "",
    annualIncome: dependent.annualIncome != null ? String(dependent.annualIncome) : "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/dependents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dependent.id, ...form }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `エラー ${res.status}`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`扶養家族${form.name ? `「${form.name}」` : ""}を削除しますか？`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/dependents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dependent.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `エラー ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">扶養家族 {index + 1}</span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-600">保存しました</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleDelete}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            削除
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-x-6 gap-y-3">
        <FormField label="氏名">
          <TextInput value={form.name} onChange={set("name")} />
        </FormField>
        <FormField label="カナ">
          <TextInput value={form.kana} onChange={set("kana")} />
        </FormField>
        <FormField label="性別">
          <TextInput value={form.gender} onChange={set("gender")} placeholder="男 / 女" />
        </FormField>
        <FormField label="続柄">
          <TextInput value={form.relation} onChange={set("relation")} placeholder="例: 長女" />
        </FormField>
        <FormField label="生年月日">
          <DateInput value={form.birthday} onChange={set("birthday")} />
        </FormField>
        <FormField label="年収（円）">
          <NumberInput value={form.annualIncome} onChange={set("annualIncome")} />
        </FormField>
      </div>
    </div>
  );
}

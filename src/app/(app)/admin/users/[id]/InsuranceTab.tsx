"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import type { InsuranceData, DependentData } from "./detail-types";
import { patchEmployeeSection } from "./detail-types";
import { FormField, TextInput, DateInput, NumberInput, TextArea, SaveBar, BlockTitle } from "./detail-ui";

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
  const [form, setForm] = useState({
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
  });
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
      await patchEmployeeSection(employeeId, "insurance", form);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <BlockTitle>雇用保険</BlockTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

          <div className="mt-6">
            <BlockTitle>社会保険</BlockTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div className="md:col-span-2">
                <FormField label="備考">
                  <TextArea value={form.socialInsuranceNote} onChange={set("socialInsuranceNote")} />
                </FormField>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <BlockTitle>扶養</BlockTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="扶養取得日">
                <DateInput value={form.dependentAcquiredDate} onChange={set("dependentAcquiredDate")} />
              </FormField>
              <FormField label="扶養喪失日">
                <DateInput value={form.dependentLostDate} onChange={set("dependentLostDate")} />
              </FormField>
            </div>
          </div>

          <SaveBar saving={saving} error={error} saved={saved} onSave={handleSave} />
        </CardBody>
      </Card>

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
    <Card>
      <CardBody>
        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-3">
          <h4 className="text-sm font-semibold text-slate-800">扶養家族</h4>
          <button
            type="button"
            disabled={adding}
            onClick={handleAdd}
            className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
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
          <p className="text-sm text-slate-500">扶養家族は登録されていません。</p>
        ) : (
          <div className="space-y-4">
            {dependents.map((dep, i) => (
              <DependentRow key={dep.id} employeeId={employeeId} dependent={dep} index={i} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
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
  const [form, setForm] = useState({
    name: dependent.name ?? "",
    kana: dependent.kana ?? "",
    gender: dependent.gender ?? "",
    relation: dependent.relation ?? "",
    birthday: dependent.birthday ?? "",
    annualIncome: dependent.annualIncome != null ? String(dependent.annualIncome) : "",
  });
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
    <div className="rounded border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-500">扶養家族 {index + 1}</span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-600">保存しました</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleDelete}
            className="rounded bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            削除
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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

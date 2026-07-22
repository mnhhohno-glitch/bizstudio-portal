"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InsuranceData, DependentData } from "./detail-types";
import {
  FormField,
  TextInput,
  DateInput,
  NumberInput,
  TextArea,
  BlockTitle,
  ResumeAiButton,
  useSectionAutoSave,
  useAutoSave,
  AutoSaveIndicator,
  RelationSelect,
} from "./detail-ui";
import { useResumeAiFill, useAiFillData } from "./useResumeAiFill";
import { filledMessage } from "./resume-ai-merge";

// T-098: 社会保険タブで AI から仮入力するのは番号類のみ。
const INSURANCE_AI_KEYS = ["pensionNumber", "employmentInsuranceNumber"] as const;

// T-096 タブ3: 社会保険（自動保存化）＋扶養家族 1:N（各行を自動保存）

export default function InsuranceTab({
  employeeId,
  insurance,
  dependents,
  aiFillData,
}: {
  employeeId: string;
  insurance: InsuranceData | null;
  dependents: DependentData[];
  aiFillData?: Record<string, unknown> | null;
}) {
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
  const autoSave = useSectionAutoSave(employeeId, "insurance", initial);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
  };
  const blurSave = (field: keyof typeof form) => () =>
    autoSave.save(field as string, form[field]);

  // T-098: 履歴書AI読み取り（空欄のみマージ）— 番号類だけ反映
  const ai = useResumeAiFill(employeeId, setForm, INSURANCE_AI_KEYS);
  // T-098 追補: 全画面D&Dの解析結果配布（番号類の空欄のみマージ）
  const dropFill = useAiFillData(aiFillData, setForm, INSURANCE_AI_KEYS);

  return (
    <div className="px-5 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <BlockTitle>雇用保険</BlockTitle>
        <div className="flex items-center gap-3">
          <AutoSaveIndicator status={autoSave.status} error={autoSave.error} />
          {dropFill.filledCount != null && (
            <span className="text-[11px] text-green-600">{filledMessage(dropFill.filledCount)}</span>
          )}
          <ResumeAiButton {...ai} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="加入状況">
          <TextInput value={form.employmentInsuranceStatus} onChange={set("employmentInsuranceStatus")} onBlur={blurSave("employmentInsuranceStatus")} placeholder="例: 加入" />
        </FormField>
        <FormField label="資格取得日">
          <DateInput value={form.employmentInsuranceAcquiredDate} onChange={set("employmentInsuranceAcquiredDate")} onBlur={blurSave("employmentInsuranceAcquiredDate")} />
        </FormField>
        <FormField label="資格喪失日">
          <DateInput value={form.employmentInsuranceLostDate} onChange={set("employmentInsuranceLostDate")} onBlur={blurSave("employmentInsuranceLostDate")} />
        </FormField>
        <FormField label="管轄">
          <TextInput value={form.employmentInsuranceArea} onChange={set("employmentInsuranceArea")} onBlur={blurSave("employmentInsuranceArea")} />
        </FormField>
        <FormField label="被保険者番号">
          <TextInput value={form.employmentInsuranceNumber} onChange={set("employmentInsuranceNumber")} onBlur={blurSave("employmentInsuranceNumber")} />
        </FormField>
        <FormField label="離職票依頼日">
          <DateInput value={form.separationNoticeRequestDate} onChange={set("separationNoticeRequestDate")} onBlur={blurSave("separationNoticeRequestDate")} />
        </FormField>
      </div>

      <div className="mt-5">
        <BlockTitle>社会保険</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="加入状況">
            <TextInput value={form.socialInsuranceStatus} onChange={set("socialInsuranceStatus")} onBlur={blurSave("socialInsuranceStatus")} placeholder="例: 加入" />
          </FormField>
          <FormField label="資格取得日">
            <DateInput value={form.socialInsuranceAcquiredDate} onChange={set("socialInsuranceAcquiredDate")} onBlur={blurSave("socialInsuranceAcquiredDate")} />
          </FormField>
          <FormField label="資格喪失日">
            <DateInput value={form.socialInsuranceLostDate} onChange={set("socialInsuranceLostDate")} onBlur={blurSave("socialInsuranceLostDate")} />
          </FormField>
          <FormField label="基礎年金番号">
            <TextInput value={form.pensionNumber} onChange={set("pensionNumber")} onBlur={blurSave("pensionNumber")} />
          </FormField>
          <div className="col-span-4">
            <FormField label="備考">
              <TextArea value={form.socialInsuranceNote} onChange={set("socialInsuranceNote")} onBlur={blurSave("socialInsuranceNote")} />
            </FormField>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <BlockTitle>扶養</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="扶養取得日">
            <DateInput value={form.dependentAcquiredDate} onChange={set("dependentAcquiredDate")} onBlur={blurSave("dependentAcquiredDate")} />
          </FormField>
          <FormField label="扶養喪失日">
            <DateInput value={form.dependentLostDate} onChange={set("dependentLostDate")} onBlur={blurSave("dependentLostDate")} />
          </FormField>
        </div>
      </div>

      <DependentsSection employeeId={employeeId} dependents={dependents} />
    </div>
  );
}

// ---- 扶養家族（1:N）----
// 各行を自動保存化。行の新規追加・削除は既存のボタン操作のまま。続柄は RelationSelect。

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
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 扶養家族の自動保存: PATCH /api/admin/employees/[employeeId]/dependents に id + 変更フィールドを投げる。
  const autoSave = useAutoSave(async (field, value) => {
    const res = await fetch(`/api/admin/employees/${employeeId}/dependents`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dependent.id, [field]: value }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `エラー ${res.status}`);
    }
  }, initial);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
  };
  const blurSave = (field: keyof typeof form) => () =>
    autoSave.save(field as string, form[field]);
  const selectSave = (field: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [field]: v }));
    autoSave.save(field as string, v);
  };

  const handleDelete = async () => {
    if (!confirm(`扶養家族${form.name ? `「${form.name}」` : ""}を削除しますか？`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/dependents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dependent.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setDeleteError(j.error || `エラー ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setDeleteError("通信エラーが発生しました");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">扶養家族 {index + 1}</span>
        <div className="flex items-center gap-2">
          <AutoSaveIndicator status={autoSave.status} error={autoSave.error} />
          {deleteError && <span className="text-xs text-red-600">{deleteError}</span>}
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "削除中..." : "削除"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-x-6 gap-y-3">
        <FormField label="氏名">
          <TextInput value={form.name} onChange={set("name")} onBlur={blurSave("name")} />
        </FormField>
        <FormField label="カナ">
          <TextInput value={form.kana} onChange={set("kana")} onBlur={blurSave("kana")} />
        </FormField>
        <FormField label="性別">
          <TextInput value={form.gender} onChange={set("gender")} onBlur={blurSave("gender")} placeholder="男 / 女" />
        </FormField>
        <FormField label="続柄">
          <RelationSelect value={form.relation} onChange={selectSave("relation")} />
        </FormField>
        <FormField label="生年月日">
          <DateInput value={form.birthday} onChange={set("birthday")} onBlur={blurSave("birthday")} />
        </FormField>
        <FormField label="年収（円）">
          <NumberInput value={form.annualIncome} onChange={set("annualIncome")} onBlur={blurSave("annualIncome")} />
        </FormField>
      </div>
    </div>
  );
}

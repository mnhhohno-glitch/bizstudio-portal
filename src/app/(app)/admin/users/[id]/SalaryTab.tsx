"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SalaryData } from "./detail-types";
import { patchEmployeeSection } from "./detail-types";
import {
  FormField,
  TextInput,
  NumberInput,
  TextArea,
  ReadOnlyField,
  SaveBar,
  BlockTitle,
} from "./detail-ui";

// T-096 タブ4: 給与手当。支給総額は DB に持たず、入力中もリアルタイムで自動合計を表示。

const AMOUNT_KEYS = [
  "baseSalary",
  "rankAllowance",
  "communicationAllowance",
  "specialAllowance",
  "commuteAllowance",
] as const;

export default function SalaryTab({
  employeeId,
  salary,
}: {
  employeeId: string;
  salary: SalaryData | null;
}) {
  const router = useRouter();
  const initial = {
    baseSalary: salary?.baseSalary != null ? String(salary.baseSalary) : "",
    rankAllowance: salary?.rankAllowance != null ? String(salary.rankAllowance) : "",
    communicationAllowance: salary?.communicationAllowance != null ? String(salary.communicationAllowance) : "",
    specialAllowance: salary?.specialAllowance != null ? String(salary.specialAllowance) : "",
    commuteAllowance: salary?.commuteAllowance != null ? String(salary.commuteAllowance) : "",
    commuteRoute: salary?.commuteRoute ?? "",
    commuteFrom: salary?.commuteFrom ?? "",
    commuteTo: salary?.commuteTo ?? "",
    commuteFareOneWay: salary?.commuteFareOneWay != null ? String(salary.commuteFareOneWay) : "",
    commuteFareRoundTrip: salary?.commuteFareRoundTrip != null ? String(salary.commuteFareRoundTrip) : "",
    memo: salary?.memo ?? "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  // 支給総額（基本給＋各手当）: 入力中もリアルタイム反映
  const total = AMOUNT_KEYS.reduce((sum, key) => {
    const n = Number(form[key]);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patchEmployeeSection(employeeId, "salary", form);
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
    <div className="px-6 py-6">
      <BlockTitle>給与</BlockTitle>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <FormField label="基本給（円）">
          <NumberInput value={form.baseSalary} onChange={set("baseSalary")} />
        </FormField>
        <FormField label="ランク手当（円）">
          <NumberInput value={form.rankAllowance} onChange={set("rankAllowance")} />
        </FormField>
        <FormField label="通信手当（円）">
          <NumberInput value={form.communicationAllowance} onChange={set("communicationAllowance")} />
        </FormField>
        <FormField label="特別手当（円）">
          <NumberInput value={form.specialAllowance} onChange={set("specialAllowance")} />
        </FormField>
        <FormField label="通勤手当（円）">
          <NumberInput value={form.commuteAllowance} onChange={set("commuteAllowance")} />
        </FormField>
        <FormField label="支給総額（自動）">
          <ReadOnlyField>{total.toLocaleString()}円</ReadOnlyField>
        </FormField>
      </div>

      <div className="mt-8">
        <BlockTitle>通勤</BlockTitle>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <FormField label="通勤経路">
            <TextInput value={form.commuteRoute} onChange={set("commuteRoute")} />
          </FormField>
          <FormField label="区間（自宅側）">
            <TextInput value={form.commuteFrom} onChange={set("commuteFrom")} />
          </FormField>
          <FormField label="区間（勤務先側）">
            <TextInput value={form.commuteTo} onChange={set("commuteTo")} />
          </FormField>
          <FormField label="運賃（片道・円）">
            <NumberInput value={form.commuteFareOneWay} onChange={set("commuteFareOneWay")} />
          </FormField>
          <FormField label="運賃（往復・円）">
            <NumberInput value={form.commuteFareRoundTrip} onChange={set("commuteFareRoundTrip")} />
          </FormField>
        </div>
      </div>

      <div className="mt-8">
        <BlockTitle>メモ</BlockTitle>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <div className="col-span-3">
            <FormField label="">
              <TextArea value={form.memo} onChange={set("memo")} rows={3} />
            </FormField>
          </div>
        </div>
      </div>

      <SaveBar saving={saving} error={error} saved={saved} onSave={handleSave} onCancel={handleCancel} />
    </div>
  );
}

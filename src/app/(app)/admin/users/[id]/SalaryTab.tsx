"use client";

import { useState } from "react";
import type { SalaryData } from "./detail-types";
import {
  FormField,
  TextInput,
  NumberInput,
  TextArea,
  ReadOnlyField,
  BlockTitle,
  useSectionAutoSave,
  AutoSaveIndicator,
} from "./detail-ui";

// T-096 タブ4: 給与手当（自動保存化）。支給総額は DB に持たず、入力中もリアルタイムで自動合計を表示。

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
  const autoSave = useSectionAutoSave(employeeId, "salary", initial);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
  };
  const blurSave = (field: keyof typeof form) => () =>
    autoSave.save(field as string, form[field]);

  // 支給総額（基本給＋各手当）: 入力中もリアルタイム反映
  const total = AMOUNT_KEYS.reduce((sum, key) => {
    const n = Number(form[key]);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div className="px-5 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <BlockTitle>給与</BlockTitle>
        <AutoSaveIndicator status={autoSave.status} error={autoSave.error} />
      </div>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="基本給（円）">
          <NumberInput value={form.baseSalary} onChange={set("baseSalary")} onBlur={blurSave("baseSalary")} />
        </FormField>
        <FormField label="ランク手当（円）">
          <NumberInput value={form.rankAllowance} onChange={set("rankAllowance")} onBlur={blurSave("rankAllowance")} />
        </FormField>
        <FormField label="通信手当（円）">
          <NumberInput value={form.communicationAllowance} onChange={set("communicationAllowance")} onBlur={blurSave("communicationAllowance")} />
        </FormField>
        <FormField label="特別手当（円）">
          <NumberInput value={form.specialAllowance} onChange={set("specialAllowance")} onBlur={blurSave("specialAllowance")} />
        </FormField>
        <FormField label="通勤手当（円）">
          <NumberInput value={form.commuteAllowance} onChange={set("commuteAllowance")} onBlur={blurSave("commuteAllowance")} />
        </FormField>
        <FormField label="支給総額（自動）">
          <ReadOnlyField>{total.toLocaleString()}円</ReadOnlyField>
        </FormField>
      </div>

      <div className="mt-5">
        <BlockTitle>通勤</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="通勤経路">
            <TextInput value={form.commuteRoute} onChange={set("commuteRoute")} onBlur={blurSave("commuteRoute")} />
          </FormField>
          <FormField label="区間（自宅側）">
            <TextInput value={form.commuteFrom} onChange={set("commuteFrom")} onBlur={blurSave("commuteFrom")} />
          </FormField>
          <FormField label="区間（勤務先側）">
            <TextInput value={form.commuteTo} onChange={set("commuteTo")} onBlur={blurSave("commuteTo")} />
          </FormField>
          <FormField label="運賃（片道・円）">
            <NumberInput value={form.commuteFareOneWay} onChange={set("commuteFareOneWay")} onBlur={blurSave("commuteFareOneWay")} />
          </FormField>
          <FormField label="運賃（往復・円）">
            <NumberInput value={form.commuteFareRoundTrip} onChange={set("commuteFareRoundTrip")} onBlur={blurSave("commuteFareRoundTrip")} />
          </FormField>
        </div>
      </div>

      <div className="mt-5">
        <BlockTitle>メモ</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <div className="col-span-4">
            <TextArea value={form.memo} onChange={set("memo")} onBlur={blurSave("memo")} rows={3} />
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BankAccountData } from "./detail-types";
import { patchEmployeeSection } from "./detail-types";
import { FormField, TextInput, SelectInput, SaveBar, BlockTitle } from "./detail-ui";

// T-096 タブ2: 口座情報

export default function BankAccountTab({
  employeeId,
  bankAccount,
}: {
  employeeId: string;
  bankAccount: BankAccountData | null;
}) {
  const router = useRouter();
  const initial = {
    bankCode: bankAccount?.bankCode ?? "",
    bankName: bankAccount?.bankName ?? "",
    branchCode: bankAccount?.branchCode ?? "",
    branchName: bankAccount?.branchName ?? "",
    accountType: bankAccount?.accountType ?? "",
    accountNumber: bankAccount?.accountNumber ?? "",
    accountHolderKana: bankAccount?.accountHolderKana ?? "",
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
      await patchEmployeeSection(employeeId, "bank", form);
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
      <BlockTitle>給与振込口座</BlockTitle>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="銀行コード">
          <TextInput value={form.bankCode} onChange={set("bankCode")} placeholder="例: 0001" />
        </FormField>
        <FormField label="銀行名">
          <TextInput value={form.bankName} onChange={set("bankName")} />
        </FormField>
        <FormField label="支店コード">
          <TextInput value={form.branchCode} onChange={set("branchCode")} placeholder="例: 123" />
        </FormField>
        <FormField label="支店名">
          <TextInput value={form.branchName} onChange={set("branchName")} />
        </FormField>
        <FormField label="口座種別">
          <SelectInput
            value={form.accountType}
            onChange={set("accountType")}
            options={[
              { value: "", label: "未設定" },
              { value: "普通", label: "普通" },
              { value: "当座", label: "当座" },
            ]}
          />
        </FormField>
        <FormField label="口座番号">
          <TextInput value={form.accountNumber} onChange={set("accountNumber")} />
        </FormField>
        <FormField label="口座名義（カナ）">
          <TextInput value={form.accountHolderKana} onChange={set("accountHolderKana")} placeholder="例: ビズスタ タロウ" />
        </FormField>
      </div>
      <SaveBar saving={saving} error={error} saved={saved} onSave={handleSave} onCancel={handleCancel} />
    </div>
  );
}

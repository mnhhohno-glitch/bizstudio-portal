"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BankAccountData } from "./detail-types";
import { patchEmployeeSection } from "./detail-types";
import { FormField, TextInput, SelectInput, SaveBar, BlockTitle, ResumeAiButton } from "./detail-ui";
import { useResumeAiFill } from "./useResumeAiFill";

const BANK_AI_KEYS = [
  "bankName",
  "bankCode",
  "branchName",
  "branchCode",
  "accountType",
  "accountNumber",
  "accountHolderKana",
] as const;

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

  // T-098: 履歴書AI読み取り（空欄のみマージ）
  const ai = useResumeAiFill(employeeId, setForm, BANK_AI_KEYS);

  // T-097: 銀行コード→銀行名 自動補完。404/通信失敗時は既存値を消さない（手入力尊重）。
  const lookupBank = async (bankCodeRaw: string) => {
    const code = bankCodeRaw.replace(/\D/g, "");
    if (code.length < 4) return;
    try {
      const res = await fetch(`/api/masters/banks/${code}`);
      if (!res.ok) return;
      const j = await res.json();
      if (j?.name) setForm((f) => ({ ...f, bankName: j.name }));
    } catch {
      /* 補完失敗は無視（手入力で続行可能） */
    }
  };

  // T-097: (銀行コード+支店コード)→支店名 自動補完。
  const lookupBranch = async (bankCodeRaw: string, branchCodeRaw: string) => {
    const bank = bankCodeRaw.replace(/\D/g, "");
    const branch = branchCodeRaw.replace(/\D/g, "");
    if (bank.length < 4 || branch.length < 3) return;
    try {
      const res = await fetch(`/api/masters/banks/${bank}/branches/${branch}`);
      if (!res.ok) return;
      const j = await res.json();
      if (j?.name) setForm((f) => ({ ...f, branchName: j.name }));
    } catch {
      /* 補完失敗は無視 */
    }
  };

  const onBankCodeChange = (v: string) => {
    set("bankCode")(v);
    if (v.replace(/\D/g, "").length === 4) lookupBank(v);
  };
  const onBranchCodeChange = (v: string) => {
    set("branchCode")(v);
    if (v.replace(/\D/g, "").length === 3) lookupBranch(form.bankCode, v);
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <BlockTitle>給与振込口座</BlockTitle>
        <ResumeAiButton {...ai} />
      </div>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="銀行コード">
          <TextInput
            value={form.bankCode}
            onChange={onBankCodeChange}
            onBlur={() => lookupBank(form.bankCode)}
            placeholder="例: 0001"
          />
        </FormField>
        <FormField label="銀行名">
          <TextInput value={form.bankName} onChange={set("bankName")} />
        </FormField>
        <FormField label="支店コード">
          <TextInput
            value={form.branchCode}
            onChange={onBranchCodeChange}
            onBlur={() => lookupBranch(form.bankCode, form.branchCode)}
            placeholder="例: 123"
          />
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

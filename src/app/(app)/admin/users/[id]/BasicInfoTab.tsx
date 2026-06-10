"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeBasic } from "./detail-types";
import { calcAge, calcTenure, patchEmployeeSection } from "./detail-types";
import {
  FormField,
  TextInput,
  DateInput,
  SelectInput,
  ReadOnlyField,
  SaveBar,
  BlockTitle,
} from "./detail-ui";

// T-096 タブ1: 基本情報（ヘッダー全項目の編集＋住所・電話・緊急連絡先）

export default function BasicInfoTab({
  employee,
  todayJst,
}: {
  employee: EmployeeBasic;
  todayJst: string;
}) {
  const router = useRouter();
  const initial = {
    employeeNumber: employee.employeeNumber,
    name: employee.name,
    furigana: employee.furigana ?? "",
    birthday: employee.birthday ?? "",
    gender: employee.gender ?? "",
    status: employee.status as string,
    hireDate: employee.hireDate ?? "",
    resignDate: employee.resignDate ?? "",
    address: employee.address ?? "",
    phone: employee.phone ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactRelation: employee.emergencyContactRelation ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  // 入力中のリアルタイム計算（保存前でも確認できる）
  const age = calcAge(form.birthday || null, todayJst);
  const tenure = calcTenure(form.hireDate || null, form.resignDate || null, todayJst);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patchEmployeeSection(employee.id, "basic", form);
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
      <BlockTitle>基本情報</BlockTitle>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="社員番号">
          <TextInput value={form.employeeNumber} onChange={set("employeeNumber")} />
        </FormField>
        <FormField label="氏名">
          <TextInput value={form.name} onChange={set("name")} />
        </FormField>
        <FormField label="フリガナ">
          <TextInput value={form.furigana} onChange={set("furigana")} placeholder="例: ビズスタ タロウ" />
        </FormField>
        <FormField label={`生年月日${age != null ? `（${age}歳）` : ""}`}>
          <DateInput value={form.birthday} onChange={set("birthday")} />
        </FormField>
        <FormField label="性別">
          <SelectInput
            value={form.gender}
            onChange={set("gender")}
            options={[
              { value: "", label: "未設定" },
              { value: "男", label: "男" },
              { value: "女", label: "女" },
            ]}
          />
        </FormField>
        <FormField label="在籍状態">
          <SelectInput
            value={form.status}
            onChange={set("status")}
            options={[
              { value: "active", label: "在籍" },
              { value: "disabled", label: "退社" },
            ]}
          />
        </FormField>
        <FormField label="入社日">
          <DateInput value={form.hireDate} onChange={set("hireDate")} />
        </FormField>
        <FormField label="退社日">
          <DateInput value={form.resignDate} onChange={set("resignDate")} />
        </FormField>
        <FormField label="在籍年数（自動）">
          <ReadOnlyField>{tenure ?? "—"}</ReadOnlyField>
        </FormField>
      </div>

      <div className="mt-5">
        <BlockTitle>連絡先</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <div className="col-span-3">
            <FormField label="住所">
              <TextInput value={form.address} onChange={set("address")} />
            </FormField>
          </div>
          <FormField label="電話番号">
            <TextInput value={form.phone} onChange={set("phone")} />
          </FormField>
        </div>
      </div>

      <div className="mt-5">
        <BlockTitle>緊急連絡先</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="氏名">
            <TextInput value={form.emergencyContactName} onChange={set("emergencyContactName")} />
          </FormField>
          <FormField label="続柄">
            <TextInput value={form.emergencyContactRelation} onChange={set("emergencyContactRelation")} />
          </FormField>
          <FormField label="電話番号">
            <TextInput value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} />
          </FormField>
        </div>
      </div>

      <SaveBar saving={saving} error={error} saved={saved} onSave={handleSave} onCancel={handleCancel} />
    </div>
  );
}

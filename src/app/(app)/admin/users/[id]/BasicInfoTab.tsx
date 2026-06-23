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
  ResumeAiButton,
} from "./detail-ui";
import { useResumeAiFill, useAiFillData } from "./useResumeAiFill";
import { filledMessage } from "./resume-ai-merge";

const BASIC_AI_KEYS = [
  "name",
  "furigana",
  "birthday",
  "gender",
  "postalCode",
  "address",
  "phone",
  "emergencyContactName",
  "emergencyContactRelation",
  "emergencyContactPhone",
] as const;

// T-096 タブ1: 基本情報（ヘッダー全項目の編集＋住所・電話・緊急連絡先）

export default function BasicInfoTab({
  employee,
  todayJst,
  aiFillData,
}: {
  employee: EmployeeBasic;
  todayJst: string;
  aiFillData?: Record<string, unknown> | null;
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
    postalCode: employee.postalCode ?? "",
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
  // T-097: 郵便番号で複数住所候補が返った場合の選択肢（1件は自動入力するため空のまま）
  const [postalCandidates, setPostalCandidates] = useState<string[]>([]);

  // T-098: 履歴書AI読み取り（空欄のみマージ）
  const ai = useResumeAiFill(employee.id, setForm, BASIC_AI_KEYS);
  // T-098 追補: 全画面D&Dの解析結果配布（自タブの空欄のみマージ）
  const dropFill = useAiFillData(aiFillData, setForm, BASIC_AI_KEYS);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  // T-097: 郵便番号→住所 自動補完。1件は自動入力、複数件は候補ドロップダウン、0件は何もしない。
  const lookupPostal = async (raw: string) => {
    const code = raw.replace(/\D/g, "");
    if (code.length < 7) return;
    try {
      const res = await fetch(`/api/masters/postal-code/${code}`);
      if (!res.ok) return;
      const j = await res.json();
      const matches: string[] = (j?.matches ?? []).map(
        (m: { address: string }) => m.address,
      );
      if (matches.length === 1) {
        setForm((f) => ({ ...f, address: matches[0] }));
        setPostalCandidates([]);
        setSaved(false);
      } else if (matches.length > 1) {
        setPostalCandidates(matches);
      } else {
        setPostalCandidates([]);
      }
    } catch {
      setPostalCandidates([]);
    }
  };

  const onPostalChange = (v: string) => {
    set("postalCode")(v);
    if (v.replace(/\D/g, "").length === 7) lookupPostal(v);
  };

  const selectPostalCandidate = (addr: string) => {
    setForm((f) => ({ ...f, address: addr }));
    setPostalCandidates([]);
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <BlockTitle>基本情報</BlockTitle>
        <div className="flex items-center gap-3">
          {dropFill.filledCount != null && (
            <span className="text-[11px] text-green-600">{filledMessage(dropFill.filledCount)}</span>
          )}
          <ResumeAiButton {...ai} />
        </div>
      </div>
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
          <FormField label="郵便番号">
            <TextInput
              value={form.postalCode}
              onChange={onPostalChange}
              onBlur={() => lookupPostal(form.postalCode)}
              placeholder="例: 1000001"
            />
          </FormField>
          {/* 郵便番号を独立した行に置くためのスペーサ */}
          <div className="col-span-3" aria-hidden />
          <div className="col-span-3">
            <FormField label="住所">
              <TextInput value={form.address} onChange={set("address")} />
            </FormField>
            {postalCandidates.length > 1 && (
              <div className="mt-1 rounded-md border border-gray-200 bg-white shadow-sm">
                <div className="px-2 py-1 text-[10px] text-gray-400">
                  住所候補（複数）— 選択してください
                </div>
                {postalCandidates.map((addr, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectPostalCandidate(addr)}
                    className="block w-full px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-blue-50"
                  >
                    {addr}
                  </button>
                ))}
              </div>
            )}
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

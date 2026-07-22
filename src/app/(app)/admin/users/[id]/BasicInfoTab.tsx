"use client";

import { useState } from "react";
import type { EmployeeBasic } from "./detail-types";
import { calcAge, calcTenure } from "./detail-types";
import {
  FormField,
  TextInput,
  DateInput,
  SelectInput,
  ReadOnlyField,
  BlockTitle,
  ResumeAiButton,
  useSectionAutoSave,
  AutoSaveIndicator,
  RelationSelect,
  AddressLookupButton,
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
// T-096 追補（自動保存化）:
//  - 保存ボタン・キャンセルボタンを撤去し、テキスト/日付は onBlur、セレクトは onChange で即保存する。
//  - 郵便番号→住所の自動反映は廃止し、隣に「住所表示」ボタンを新設した（誤上書き防止）。
//  - 緊急連絡先の続柄は選択式に変更（RelationSelect）。

export default function BasicInfoTab({
  employee,
  todayJst,
  aiFillData,
}: {
  employee: EmployeeBasic;
  todayJst: string;
  aiFillData?: Record<string, unknown> | null;
}) {
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
  // 「住所表示」ボタン結果の候補（複数件時の選択肢）。ボタンでしか設定されないため onFocus/onChange 上書きは起きない。
  const [postalCandidates, setPostalCandidates] = useState<string[]>([]);

  const autoSave = useSectionAutoSave(employee.id, "basic", initial);

  // T-098: 履歴書AI読み取り（空欄のみマージ）
  const ai = useResumeAiFill(employee.id, setForm, BASIC_AI_KEYS);
  // T-098 追補: 全画面D&Dの解析結果配布（自タブの空欄のみマージ）
  const dropFill = useAiFillData(aiFillData, setForm, BASIC_AI_KEYS);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
  };

  // テキスト・日付・数値・textarea 用: onBlur で自動保存する closure。
  const blurSave = (field: keyof typeof form) => () =>
    autoSave.save(field as string, form[field]);

  // セレクト用: onChange で form 反映＋即保存。
  const selectSave = (field: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [field]: v }));
    autoSave.save(field as string, v);
  };

  // 住所表示ボタンの結果ハンドラ。1件=即上書き（保存）、複数件=候補ドロップダウンで選択、0件=何もしない。
  const handlePostalResolved = (r: { address?: string; candidates?: string[]; message?: string }) => {
    if (r.address) {
      setForm((f) => ({ ...f, address: r.address! }));
      setPostalCandidates([]);
      autoSave.save("address", r.address);
    } else if (r.candidates && r.candidates.length > 0) {
      setPostalCandidates(r.candidates);
    } else {
      setPostalCandidates([]);
    }
  };

  const selectPostalCandidate = (addr: string) => {
    setForm((f) => ({ ...f, address: addr }));
    setPostalCandidates([]);
    autoSave.save("address", addr);
  };

  // 入力中のリアルタイム計算（保存前でも確認できる）
  const age = calcAge(form.birthday || null, todayJst);
  const tenure = calcTenure(form.hireDate || null, form.resignDate || null, todayJst);

  return (
    <div className="px-5 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <BlockTitle>基本情報</BlockTitle>
        <div className="flex items-center gap-3">
          <AutoSaveIndicator status={autoSave.status} error={autoSave.error} />
          {dropFill.filledCount != null && (
            <span className="text-[11px] text-green-600">{filledMessage(dropFill.filledCount)}</span>
          )}
          <ResumeAiButton {...ai} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3">
        <FormField label="社員番号">
          <TextInput value={form.employeeNumber} onChange={set("employeeNumber")} onBlur={blurSave("employeeNumber")} />
        </FormField>
        <FormField label="氏名">
          <TextInput value={form.name} onChange={set("name")} onBlur={blurSave("name")} />
        </FormField>
        <FormField label="フリガナ">
          <TextInput value={form.furigana} onChange={set("furigana")} onBlur={blurSave("furigana")} placeholder="例: ビズスタ タロウ" />
        </FormField>
        <FormField label={`生年月日${age != null ? `（${age}歳）` : ""}`}>
          <DateInput value={form.birthday} onChange={set("birthday")} onBlur={blurSave("birthday")} />
        </FormField>
        <FormField label="性別">
          <SelectInput
            value={form.gender}
            onChange={selectSave("gender")}
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
            onChange={selectSave("status")}
            options={[
              { value: "active", label: "在籍" },
              { value: "disabled", label: "退社" },
            ]}
          />
        </FormField>
        <FormField label="入社日">
          <DateInput value={form.hireDate} onChange={set("hireDate")} onBlur={blurSave("hireDate")} />
        </FormField>
        <FormField label="退社日">
          <DateInput value={form.resignDate} onChange={set("resignDate")} onBlur={blurSave("resignDate")} />
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
              onChange={set("postalCode")}
              onBlur={blurSave("postalCode")}
              placeholder="例: 1000001"
            />
          </FormField>
          <div>
            <label className="block text-[10px] text-gray-400 mb-1">&nbsp;</label>
            <AddressLookupButton postalCode={form.postalCode} onResolved={handlePostalResolved} />
          </div>
          {/* 郵便番号＋ボタンを独立行に置くためのスペーサ */}
          <div className="col-span-2" aria-hidden />
          <div className="col-span-3">
            <FormField label="住所">
              <TextInput value={form.address} onChange={set("address")} onBlur={blurSave("address")} />
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
            <TextInput value={form.phone} onChange={set("phone")} onBlur={blurSave("phone")} />
          </FormField>
        </div>
      </div>

      <div className="mt-5">
        <BlockTitle>緊急連絡先</BlockTitle>
        <div className="grid grid-cols-4 gap-x-6 gap-y-3">
          <FormField label="氏名">
            <TextInput value={form.emergencyContactName} onChange={set("emergencyContactName")} onBlur={blurSave("emergencyContactName")} />
          </FormField>
          <FormField label="続柄">
            <RelationSelect value={form.emergencyContactRelation} onChange={selectSave("emergencyContactRelation")} />
          </FormField>
          <FormField label="電話番号">
            <TextInput value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} onBlur={blurSave("emergencyContactPhone")} />
          </FormField>
        </div>
      </div>
    </div>
  );
}

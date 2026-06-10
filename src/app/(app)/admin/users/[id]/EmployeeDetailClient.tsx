"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { EmployeeDetailData } from "./detail-types";
import { calcAge, calcTenure } from "./detail-types";
import BasicInfoTab from "./BasicInfoTab";
import BankAccountTab from "./BankAccountTab";
import InsuranceTab from "./InsuranceTab";
import SalaryTab from "./SalaryTab";
import EquipmentTab from "./EquipmentTab";
import LeaveTab from "./LeaveTab";

type TabKey = "basic" | "bank" | "insurance" | "salary" | "equipment" | "leave";

const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "基本情報" },
  { key: "bank", label: "口座情報" },
  { key: "insurance", label: "社会保険" },
  { key: "salary", label: "給与手当" },
  { key: "equipment", label: "貸与物" },
  { key: "leave", label: "有休" },
];

export default function EmployeeDetailClient({
  userId,
  userName,
  userEmployeeNumber,
  detail,
  todayJst,
}: {
  userId: string;
  userName: string;
  userEmployeeNumber: number | null;
  detail: EmployeeDetailData | null;
  todayJst: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("basic");

  // Employee 未登録時の作成フォーム
  const [newEmployeeNumber, setNewEmployeeNumber] = useState(
    userEmployeeNumber != null ? String(userEmployeeNumber) : "",
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newEmployeeNumber.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, employeeNumber: newEmployeeNumber.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setCreateError(j.error || `エラー ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setCreateError("通信エラーが発生しました");
    } finally {
      setCreating(false);
    }
  };

  if (!detail) {
    return (
      <Card>
        <CardHeader title="社員情報（Employee）が未登録です" />
        <CardBody>
          <p className="text-sm text-slate-600 mb-4">
            {userName} さんにはまだ社員情報（Employee レコード）が紐づいていません。
            社員番号を入力して作成すると、詳細情報（口座・社会保険・給与手当・貸与物・有休）を管理できます。
          </p>
          {createError && (
            <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {createError}
            </div>
          )}
          <div className="flex items-end gap-3 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">社員番号</label>
              <input
                type="text"
                value={newEmployeeNumber}
                onChange={(e) => setNewEmployeeNumber(e.target.value)}
                placeholder="例: 1000026"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              disabled={creating || !newEmployeeNumber.trim()}
              onClick={handleCreate}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "作成中..." : "社員情報を作成"}
            </button>
          </div>
          <div className="mt-6">
            <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">
              ← 社員管理に戻る
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  const e = detail.employee;
  const age = calcAge(e.birthday, todayJst);
  const tenure = calcTenure(e.hireDate, e.resignDate, todayJst);

  const headerItems: { label: string; value: React.ReactNode }[] = [
    { label: "社員番号", value: <span className="font-mono">{e.employeeNumber}</span> },
    {
      label: "氏名",
      value: (
        <span>
          {e.name}
          {e.furigana && <span className="ml-2 text-xs text-slate-500">（{e.furigana}）</span>}
        </span>
      ),
    },
    {
      label: "生年月日",
      value: e.birthday ? (
        <span>
          {e.birthday}
          {age != null && <span className="ml-1 text-slate-500">（{age}歳）</span>}
        </span>
      ) : (
        <span className="text-slate-400">未設定</span>
      ),
    },
    { label: "性別", value: e.gender ?? <span className="text-slate-400">未設定</span> },
    {
      label: "在籍状態",
      value: (
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
            e.status === "active"
              ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
              : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
          }`}
        >
          {e.status === "active" ? "在籍" : "退社"}
        </span>
      ),
    },
    { label: "入社日", value: e.hireDate ?? <span className="text-slate-400">未設定</span> },
    { label: "退社日", value: e.resignDate ?? <span className="text-slate-400">-</span> },
    {
      label: "在籍年数",
      value: tenure ?? <span className="text-slate-400">-</span>,
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">
          ← 社員管理に戻る
        </Link>
      </div>

      {/* ヘッダー（常時表示） */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            {headerItems.map((item) => (
              <div key={item.label}>
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="mt-0.5 text-sm text-slate-800">{item.value}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* タブ */}
      <div className="mt-6">
        <div className="flex border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "basic" && <BasicInfoTab employee={e} todayJst={todayJst} />}
          {tab === "bank" && <BankAccountTab employeeId={e.id} bankAccount={detail.bankAccount} />}
          {tab === "insurance" && (
            <InsuranceTab
              employeeId={e.id}
              insurance={detail.insurance}
              dependents={detail.dependents}
            />
          )}
          {tab === "salary" && <SalaryTab employeeId={e.id} salary={detail.salary} />}
          {tab === "equipment" && <EquipmentTab employeeId={e.id} equipment={detail.equipment} />}
          {tab === "leave" && (
            <LeaveTab
              employeeId={e.id}
              paidLeave={e.paidLeave}
              leaveRequests={detail.leaveRequests}
            />
          )}
        </div>
      </div>
    </div>
  );
}

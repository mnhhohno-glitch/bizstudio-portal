"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EmployeeDetailData } from "./detail-types";
import { calcAge, calcTenure } from "./detail-types";
import BasicInfoTab from "./BasicInfoTab";
import BankAccountTab from "./BankAccountTab";
import InsuranceTab from "./InsuranceTab";
import SalaryTab from "./SalaryTab";
import EquipmentTab from "./EquipmentTab";
import LeaveTab from "./LeaveTab";
import EmployeeSearchSwitcher from "./EmployeeSearchSwitcher";
import type { EmployeeListItem } from "./EmployeeSearchSwitcher";
import AccountSettingsBar from "./AccountSettingsBar";

type TabKey = "basic" | "bank" | "insurance" | "salary" | "equipment" | "leave";

const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "基本情報" },
  { key: "bank", label: "口座情報" },
  { key: "insurance", label: "社会保険" },
  { key: "salary", label: "給与手当" },
  { key: "equipment", label: "貸与物" },
  { key: "leave", label: "有休" },
];

const JOB_CATEGORY_LABEL: Record<string, string> = {
  CA: "CA",
  MARKETING: "マーケ",
  OFFICE_AND_MGMT: "事務・管理",
};

function MiniField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-gray-400 whitespace-nowrap">{label}</div>
      <div className="mt-0.5 text-[12px] text-slate-800 whitespace-nowrap">{value}</div>
    </div>
  );
}

export default function EmployeeDetailClient({
  userId,
  userName,
  userEmail,
  userEmployeeNumber,
  userRole,
  userLineworksId,
  userIsMynaviAssignee,
  allEmployees,
  detail,
  todayJst,
}: {
  userId: string;
  userName: string;
  userEmail: string;
  userEmployeeNumber: number | null;
  userRole: string;
  userLineworksId: string | null;
  userIsMynaviAssignee: boolean;
  allEmployees: EmployeeListItem[];
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

  // T-098 追補: 全画面D&Dで複数ファイルを1回解析→全タブに配布する。
  const employeeIdForAi = detail?.employee.id ?? null;
  const [aiFillData, setAiFillData] = useState<Record<string, unknown> | null>(null);
  const [aiDropLoading, setAiDropLoading] = useState(false);
  const [aiDropError, setAiDropError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const aiLoadingRef = useRef(false);
  aiLoadingRef.current = aiDropLoading;

  const handleAiDrop = async (files: File[]) => {
    if (!employeeIdForAi || aiLoadingRef.current || files.length === 0) return;
    setAiDropLoading(true);
    setAiDropError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/admin/employees/${employeeIdForAi}/parse-resume`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `エラー ${res.status}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      // 新しい参照を渡すことで各タブの useAiFillData が1回だけ空欄マージする
      setAiFillData(data);
    } catch (err) {
      setAiDropError(err instanceof Error ? err.message : "AI解析に失敗しました");
    } finally {
      setAiDropLoading(false);
    }
  };
  // 最新の handleAiDrop を ref 経由で document リスナーから呼ぶ（stale closure 回避）
  const handleDropRef = useRef(handleAiDrop);
  handleDropRef.current = handleAiDrop;

  // 画面全体のドラッグ＆ドロップ。Employee 未登録（detail なし）では無効。
  useEffect(() => {
    if (!detail) return;
    const hasFiles = (ev: DragEvent) =>
      Array.from(ev.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      dragCounter.current++;
      setDragging(true);
    };
    const onOver = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
    };
    const onLeave = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragging(false);
      }
    };
    const onDrop = (ev: DragEvent) => {
      if (!ev.dataTransfer) return;
      ev.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      if (aiLoadingRef.current) return; // 解析中の多重ドロップ無視
      const files = Array.from(ev.dataTransfer.files ?? []);
      if (files.length) handleDropRef.current(files);
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [detail]);

  if (!detail) {
    return (
      <div className="max-w-7xl">
        {/* 戻るリンク＋検索切替（カード外の独立行） */}
        <div className="mb-3 flex items-center justify-between gap-4">
          <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">
            ← 社員管理に戻る
          </Link>
          <EmployeeSearchSwitcher employees={allEmployees} currentUserId={userId} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-8">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">社員情報（Employee）が未登録です</h3>
          <p className="text-sm text-slate-600 mb-5">
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
              <label className="block text-[11px] text-gray-400 mb-1">社員番号</label>
              <input
                type="text"
                value={newEmployeeNumber}
                onChange={(e) => setNewEmployeeNumber(e.target.value)}
                placeholder="例: 1000026"
                className="w-full border-0 border-b border-gray-300 rounded-none px-0 py-1.5 text-sm bg-transparent focus:ring-0 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={creating || !newEmployeeNumber.trim()}
              onClick={handleCreate}
              className="rounded bg-blue-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {creating ? "作成中..." : "社員情報を作成"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const e = detail.employee;
  const age = calcAge(e.birthday, todayJst);
  const tenure = calcTenure(e.hireDate, e.resignDate, todayJst);
  const jobCategoryLabel = e.jobCategory ? JOB_CATEGORY_LABEL[e.jobCategory] : null;
  const initial = (e.name || userName).trim().charAt(0) || "員";
  const isActive = e.status === "active";

  // 入社 / 退社 表示
  const enrollText =
    e.hireDate && e.resignDate
      ? `${e.hireDate} 〜 ${e.resignDate}`
      : e.hireDate
        ? `${e.hireDate} 〜`
        : e.resignDate
          ? `〜 ${e.resignDate}`
          : "—";

  return (
    <div className="max-w-7xl">
      {/* T-098 追補: 全画面D&Dオーバーレイ（ドラッグ中 or 解析中のみ・視覚フィードバック） */}
      {(dragging || aiDropLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-900/20 backdrop-blur-[1px] pointer-events-none">
          <div className="rounded-xl border-2 border-dashed border-blue-400 bg-white/95 px-10 py-7 text-center shadow-xl">
            <div className="text-[15px] font-medium text-blue-800">
              {aiDropLoading ? "解析中…" : "書類をドロップしてAI読み取り"}
            </div>
            <div className="mt-1 text-[12px] text-blue-600">
              {aiDropLoading
                ? "全タブの空欄をまとめて仮入力します"
                : "複数可・PDF / Word / 画像（最大5ファイル・合計30MB）"}
            </div>
          </div>
        </div>
      )}

      {/* 戻るリンク＋他社員検索切替（カード外の独立行） */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">
          ← 社員管理に戻る
        </Link>
        <EmployeeSearchSwitcher employees={allEmployees} currentUserId={userId} />
      </div>

      {aiDropError && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <span>{aiDropError}</span>
          <button
            type="button"
            onClick={() => setAiDropError(null)}
            className="text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* カード本体 */}
      <div className="rounded-xl border border-gray-200 bg-white">
      {/* 人物ヘッダー（高さを揃え、中身を垂直中央に） */}
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-4 min-h-[56px]">
          {/* イニシャルアバター */}
          <div className="w-12 h-12 rounded-full bg-[#E6F1FB] text-[#0C447C] font-medium text-base flex items-center justify-center shrink-0">
            {initial}
          </div>

          {/* 氏名ブロック */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[17px] font-medium text-slate-800">{e.name}</span>
              {e.furigana && <span className="text-[11px] text-gray-400">{e.furigana}</span>}
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${
                  isActive
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-gray-100 text-gray-600 border border-gray-200"
                }`}
              >
                {isActive ? "在籍" : "退社"}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-gray-500">
              {e.employeeNumber}
              <span className="mx-1.5">・</span>
              <span className="font-mono">{userEmail}</span>
              {jobCategoryLabel && (
                <>
                  <span className="mx-1.5">・</span>
                  {jobCategoryLabel}
                </>
              )}
            </div>
          </div>

          {/* 右ミニグリッド（横1列に4項目・氏名ブロックと垂直中央で揃える） */}
          <div className="flex items-center gap-x-[18px] shrink-0">
            <MiniField
              label="生年月日"
              value={
                e.birthday ? (
                  <span>
                    {e.birthday}
                    {age != null && <span className="ml-1 text-gray-500">{age}歳</span>}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <MiniField label="性別" value={e.gender || "—"} />
            <MiniField label="入社 / 退社" value={enrollText} />
            <MiniField label="在籍年数" value={tenure ?? "—"} />
          </div>
        </div>
      </div>

      {/* アカウント設定行（Task 5: 一覧モーダル相当の項目をヘッダーで編集） */}
      <AccountSettingsBar
        userId={userId}
        email={userEmail}
        role={userRole}
        jobCategory={e.jobCategory}
        lineworksId={userLineworksId}
        isMynaviAssignee={userIsMynaviAssignee}
        hasEmployee={true}
      />

      {/* タブバー（アカウント設定行の直下） */}
      <div className="px-5 border-b border-gray-200">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-[12px] -mb-px border-b-2 transition-colors ${
                tab === t.key
                  ? "border-blue-700 text-blue-700 font-medium"
                  : "border-transparent text-gray-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* タブコンテンツ */}
      <div>
        {tab === "basic" && <BasicInfoTab employee={e} todayJst={todayJst} aiFillData={aiFillData} />}
        {tab === "bank" && (
          <BankAccountTab employeeId={e.id} bankAccount={detail.bankAccount} aiFillData={aiFillData} />
        )}
        {tab === "insurance" && (
          <InsuranceTab
            employeeId={e.id}
            insurance={detail.insurance}
            dependents={detail.dependents}
            aiFillData={aiFillData}
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

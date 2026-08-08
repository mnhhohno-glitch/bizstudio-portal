"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { generatePatternName, machineLabel } from "@/lib/rpa-scout/pattern-name";
import { DEFAULT_WORK_LOCATIONS, WORK_LOCATION_OPTIONS } from "@/lib/rpa-scout/area";
import {
  COMPANY_COUNT_OPTIONS,
  EDUCATION_OPTIONS,
  JOB_CATEGORY_PRIORITY_OPTIONS,
  SEND_STATUS_OPTIONS,
  TRANSFER_TIMING_OPTIONS,
  WORK_LOCATION_PRIORITY_OPTIONS,
} from "@/lib/rpa-scout/constants";
import type { JobCategoryRow, RpaPattern } from "./types";
import AreaSelector from "./AreaSelector";
import JobCategorySelector from "./JobCategorySelector";

// パターン新規作成／編集フォーム。
// 画面上部に「N号機：生成名」のリアルタイムプレビューを固定表示（保存時と同一の生成関数を使用）
export default function PatternFormModal({
  pattern,
  existingPatterns,
  categories,
  onClose,
  onSaved,
}: {
  pattern: RpaPattern | null; // null=新規
  existingPatterns: RpaPattern[];
  categories: JobCategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const overlayClose = useOverlayClose(onClose);
  const isNew = pattern == null;

  const [targetMachineNo, setTargetMachineNo] = useState<string>(
    pattern?.targetMachineNo != null ? String(pattern.targetMachineNo) : ""
  );
  const [sendStatus, setSendStatus] = useState(pattern?.sendStatus ?? "");
  const [registDays, setRegistDays] = useState<string>(
    pattern?.registDays != null ? String(pattern.registDays) : ""
  );
  const [registDirection, setRegistDirection] = useState(pattern?.registDirection ?? "WITHIN");
  const [lastLoginDays, setLastLoginDays] = useState<string>(
    pattern?.lastLoginDays != null ? String(pattern.lastLoginDays) : "1"
  );
  const [areaType, setAreaType] = useState<string | null>(pattern?.areaType ?? null);
  const [prefectures, setPrefectures] = useState<string[]>(pattern?.prefectures ?? []);
  const [education, setEducation] = useState(pattern?.education ?? "");
  const [gradYearFrom, setGradYearFrom] = useState<string>(
    pattern?.gradYearFrom != null ? String(pattern.gradYearFrom) : ""
  );
  const [gradYearTo, setGradYearTo] = useState<string>(
    pattern?.gradYearTo != null ? String(pattern.gradYearTo) : ""
  );
  const [companyCount, setCompanyCount] = useState<string>(
    pattern?.companyCount != null ? String(pattern.companyCount) : ""
  );
  const [workLocationPriority, setWorkLocationPriority] = useState(
    pattern?.workLocationPriority ?? ""
  );
  const [workLocations, setWorkLocations] = useState<string[]>(
    pattern?.workLocations ?? [...DEFAULT_WORK_LOCATIONS]
  );
  const [transferTiming, setTransferTiming] = useState(pattern?.transferTiming ?? "");
  const [jobCategories, setJobCategories] = useState<string[]>(pattern?.jobCategories ?? []);
  const [jobCategoryPriority, setJobCategoryPriority] = useState(
    pattern?.jobCategoryPriority ?? ""
  );
  const [saving, setSaving] = useState(false);

  const input = useMemo(
    () => ({
      sendStatus: sendStatus || null,
      registDays: registDays === "" ? null : Number(registDays),
      registDirection: registDays === "" ? null : registDirection,
      lastLoginDays: lastLoginDays === "" ? null : Number(lastLoginDays),
      areaType,
      prefectures,
      education: education || null,
      gradYearFrom: gradYearFrom === "" ? null : Number(gradYearFrom),
      gradYearTo: gradYearTo === "" ? null : Number(gradYearTo),
      companyCount: companyCount === "" ? null : Number(companyCount),
      jobCategories,
      jobCategoryPriority: jobCategoryPriority || null,
      workLocations,
      workLocationPriority: workLocationPriority || null,
      transferTiming: transferTiming || null,
    }),
    [
      sendStatus,
      registDays,
      registDirection,
      lastLoginDays,
      areaType,
      prefectures,
      education,
      gradYearFrom,
      gradYearTo,
      companyCount,
      jobCategories,
      jobCategoryPriority,
      workLocations,
      workLocationPriority,
      transferTiming,
    ]
  );

  // プレビューは保存時と同一関数
  const previewName = useMemo(() => generatePatternName(input), [input]);
  const machineNoNum = targetMachineNo === "" ? null : Number(targetMachineNo);
  const previewFull = `${machineLabel(machineNoNum)}：${previewName}`;

  const duplicateExists = useMemo(
    () =>
      previewName !== "" &&
      existingPatterns.some((p) => p.isActive && p.name === previewName && p.id !== pattern?.id),
    [existingPatterns, previewName, pattern?.id]
  );

  const copyPreview = () => {
    navigator.clipboard.writeText(previewFull).then(() => toast.success("コピーしました"));
  };

  const toggleWorkLocation = (loc: string) => {
    setWorkLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  };

  const save = async () => {
    if (!previewName) {
      toast.error("条件を選択してください");
      return;
    }
    setSaving(true);
    const payload = { targetMachineNo: machineNoNum, ...input };
    const res = await fetch(
      isNew ? "/api/rpa-scout/patterns" : `/api/rpa-scout/patterns/${pattern!.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      if (data.duplicateWarning) {
        toast.warning("同名のパターンが既に存在します（保存済み）");
      } else {
        toast.success(isNew ? "作成しました" : "保存しました");
      }
      onSaved();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "保存に失敗しました");
    }
  };

  const label = "mb-1 block text-[12px] font-semibold text-[#6B7280]";
  const inputCls = "rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[14px]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-[15px] font-bold text-[#374151]">
            {isNew ? "パターン新規作成" : "パターン編集"}
          </h2>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        {/* リアルタイムプレビュー（固定表示） */}
        <div className="border-b bg-[#F8FAFC] px-5 py-3">
          <div className="mb-0.5 text-[11px] font-semibold text-[#6B7280]">
            生成されるパターン名
          </div>
          <div className="flex items-start gap-2">
            <span className="break-all text-[14px] font-medium text-[#111827]">
              {previewName ? previewFull : "（条件を選択すると自動生成されます）"}
            </span>
            {previewName && (
              <button
                onClick={copyPreview}
                title="コピー"
                className="shrink-0 rounded px-1 text-[#6B7280] hover:bg-[#E5E7EB]"
              >
                📋
              </button>
            )}
          </div>
          {duplicateExists && (
            <div className="mt-1 text-[12px] font-medium text-[#D97706]">
              ⚠ 同名のパターンが既に存在します（保存は可能です）
            </div>
          )}
          {!isNew && pattern?.isMigrated && (
            <div className="mt-1 text-[12px] text-[#6B7280]">
              移行パターンです。保存すると名前が自動生成名で上書きされ、移行フラグが外れます。
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>対象号機</label>
              <select
                value={targetMachineNo}
                onChange={(e) => setTargetMachineNo(e.target.value)}
                className={`${inputCls} w-full`}
              >
                <option value="">全号機</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}号機
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>送信状態</label>
              <div className="flex gap-3 pt-1.5">
                {SEND_STATUS_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-[14px]">
                    <input
                      type="radio"
                      name="sendStatus"
                      checked={sendStatus === o.value}
                      onChange={() => setSendStatus(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>登録日</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={registDays}
                  onChange={(e) => setRegistDays(e.target.value)}
                  className={`${inputCls} w-20`}
                />
                <span className="text-[13px]">日</span>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-[13px]">
                    <input
                      type="radio"
                      name="registDirection"
                      checked={registDirection === "WITHIN"}
                      onChange={() => setRegistDirection("WITHIN")}
                    />
                    以内
                  </label>
                  <label className="flex items-center gap-1 text-[13px]">
                    <input
                      type="radio"
                      name="registDirection"
                      checked={registDirection === "AFTER"}
                      onChange={() => setRegistDirection("AFTER")}
                    />
                    以降
                  </label>
                </div>
              </div>
              <div className="mt-0.5 text-[11px] text-[#9CA3AF]">
                7日以内=開放日 / 8日以降=既登録
              </div>
            </div>
            <div>
              <label className={label}>最終ログイン日</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={lastLoginDays}
                  onChange={(e) => setLastLoginDays(e.target.value)}
                  className={`${inputCls} w-20`}
                />
                <span className="text-[13px]">
                  {lastLoginDays !== "" ? `${lastLoginDays}日以内` : ""}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-[#9CA3AF]">デフォルト1（名前に含めない）</div>
            </div>
          </div>

          <div>
            <label className={label}>エリア</label>
            <AreaSelector
              areaType={areaType}
              prefectures={prefectures}
              onChange={(t, p) => {
                setAreaType(t);
                setPrefectures(p);
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={label}>学歴</label>
              <select
                value={education}
                onChange={(e) => setEducation(e.target.value)}
                className={`${inputCls} w-full`}
              >
                <option value="">未選択</option>
                {EDUCATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>卒業年度（西暦4桁）</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder="2015"
                  value={gradYearFrom}
                  onChange={(e) => setGradYearFrom(e.target.value)}
                  className={`${inputCls} w-full`}
                />
                <span>〜</span>
                <input
                  type="number"
                  placeholder="2025"
                  value={gradYearTo}
                  onChange={(e) => setGradYearTo(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>
            </div>
            <div>
              <label className={label}>経験社数</label>
              <select
                value={companyCount}
                onChange={(e) => setCompanyCount(e.target.value)}
                className={`${inputCls} w-full`}
              >
                <option value="">未選択</option>
                {COMPANY_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    〜{n}社
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>勤務地順位</label>
              <div className="flex gap-3 pt-1.5">
                {WORK_LOCATION_PRIORITY_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-[14px]">
                    <input
                      type="radio"
                      name="workLocationPriority"
                      checked={workLocationPriority === o.value}
                      onChange={() => setWorkLocationPriority(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>転職希望時期</label>
              <select
                value={transferTiming}
                onChange={(e) => setTransferTiming(e.target.value)}
                className={`${inputCls} w-full`}
              >
                <option value="">未選択（デフォルト）</option>
                {TRANSFER_TIMING_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>
              希望勤務地（デフォルト: {DEFAULT_WORK_LOCATIONS.join("/")}）
            </label>
            <div className="max-h-32 overflow-y-auto rounded-[6px] border border-[#E5E7EB] p-2">
              <div className="grid grid-cols-4 gap-1">
                {WORK_LOCATION_OPTIONS.map((loc) => (
                  <label key={loc} className="flex items-center gap-1.5 text-[13px] text-[#374151]">
                    <input
                      type="checkbox"
                      checked={workLocations.includes(loc)}
                      onChange={() => toggleWorkLocation(loc)}
                    />
                    {loc}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className={label}>希望職種（大→中→小の3階層・最大3件）</label>
            <JobCategorySelector
              categories={categories}
              selected={jobCategories}
              onChange={setJobCategories}
            />
          </div>

          <div>
            <label className={label}>希望職種順位</label>
            <select
              value={jobCategoryPriority}
              onChange={(e) => setJobCategoryPriority(e.target.value)}
              className={`${inputCls} w-48`}
            >
              <option value="">指定なし（デフォルト）</option>
              {JOB_CATEGORY_PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

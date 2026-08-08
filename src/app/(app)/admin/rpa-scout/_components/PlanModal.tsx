"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { displayPatternName } from "@/lib/rpa-scout/pattern-name";
import { TIME_SLOTS } from "@/lib/rpa-scout/constants";
import { ymdWeekday } from "@/lib/rpa-scout/jst";
import { fmtJstDate, type RpaPattern, type RpaPlan, type RpaTemplate } from "./types";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 配信計画の作成／編集モーダル（日付・号機はセルからプリセット）
export default function PlanModal({
  plan,
  presetDate,
  presetMachineNo,
  patterns,
  templates,
  onClose,
  onSaved,
}: {
  plan: RpaPlan | null; // null=新規
  presetDate: string | null;
  presetMachineNo: number | null;
  patterns: RpaPattern[];
  templates: RpaTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const overlayClose = useOverlayClose(onClose);
  const isNew = plan == null;
  const date = isNew ? presetDate! : fmtJstDate(plan.planDate);
  const machineNo = isNew ? presetMachineNo! : plan.machineNo;

  const [timeSlot, setTimeSlot] = useState(plan?.timeSlot ?? "");
  const [patternId, setPatternId] = useState(plan?.patternId ?? "");
  const [subjectTemplateId, setSubjectTemplateId] = useState(plan?.subjectTemplateId ?? "");
  const [memo, setMemo] = useState(plan?.memo ?? "");
  const [saving, setSaving] = useState(false);

  // その号機用＋全号機用を上に
  const { own, others } = useMemo(() => {
    const own = patterns.filter(
      (p) => p.targetMachineNo === machineNo || p.targetMachineNo == null
    );
    const others = patterns.filter(
      (p) => p.targetMachineNo != null && p.targetMachineNo !== machineNo
    );
    return { own, others };
  }, [patterns, machineNo]);

  const activeTemplates = templates.filter((t) => t.isActive);

  const save = async () => {
    if (!timeSlot) {
      toast.error("時間帯を選択してください");
      return;
    }
    if (!patternId) {
      toast.error("パターンを選択してください");
      return;
    }
    if (!subjectTemplateId) {
      toast.error("件名テンプレートを選択してください");
      return;
    }
    setSaving(true);
    const res = await fetch(isNew ? "/api/rpa-scout/plans" : `/api/rpa-scout/plans/${plan!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isNew
          ? { planDate: date, machineNo, timeSlot, patternId, subjectTemplateId, memo }
          : { timeSlot, patternId, subjectTemplateId, memo }
      ),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(isNew ? "計画を作成しました" : "計画を更新しました");
      onSaved();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "保存に失敗しました");
    }
  };

  const remove = async () => {
    if (!plan) return;
    if (!confirm("この計画を削除しますか？")) return;
    const res = await fetch(`/api/rpa-scout/plans/${plan.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("削除しました");
      onSaved();
    } else {
      toast.error("削除に失敗しました");
    }
  };

  const label = "mb-1 block text-[12px] font-semibold text-[#6B7280]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-[15px] font-bold text-[#374151]">
            {isNew ? "配信計画を作成" : "配信計画を編集"} — {date}（
            {WEEKDAY_LABELS[ymdWeekday(date)]}）{machineNo}号機
          </h2>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="space-y-4 p-5 text-[14px]">
          <div>
            <label className={label}>時間帯（必須）</label>
            <div className="flex gap-3 pt-1">
              {TIME_SLOTS.map((s) => (
                <label key={s.value} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="timeSlot"
                    checked={timeSlot === s.value}
                    onChange={() => setTimeSlot(s.value)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={label}>パターン</label>
            <select
              value={patternId}
              onChange={(e) => setPatternId(e.target.value)}
              className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
            >
              <option value="">選択してください</option>
              <optgroup label={`${machineNo}号機用・全号機用`}>
                {own.map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayPatternName(p.targetMachineNo, p.name)}
                  </option>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="────── 他号機用 ──────">
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {displayPatternName(p.targetMachineNo, p.name)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div>
            <label className={label}>件名テンプレート</label>
            <select
              value={subjectTemplateId}
              onChange={(e) => setSubjectTemplateId(e.target.value)}
              className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
            >
              <option value="">選択してください</option>
              {activeTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>メモ（任意）</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <div>
            {!isNew && (
              <button
                onClick={remove}
                className="rounded-[6px] border border-[#FCA5A5] px-3 py-1.5 text-[13px] text-[#DC2626] hover:bg-[#FEF2F2]"
              >
                削除
              </button>
            )}
          </div>
          <div className="flex gap-2">
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
    </div>
  );
}

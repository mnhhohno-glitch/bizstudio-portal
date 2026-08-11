"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { displayPatternName } from "@/lib/rpa-scout/pattern-name";
import { TIME_SLOTS } from "@/lib/rpa-scout/constants";
import { achievementPct } from "@/lib/rpa-scout/dashboard";
import { nowJstDateTimeLocal, ymdWeekday } from "@/lib/rpa-scout/jst";
import {
  fmtJstDate,
  fmtJstDateTime,
  isRecentlyUsed,
  lastUsedSuffix,
  type RpaPattern,
  type RpaPlan,
  type RpaTemplate,
} from "./types";
import LastUsedNote from "./LastUsedNote";
import SubjectTemplateSelect from "./SubjectTemplateSelect";

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
  const [expectedCount, setExpectedCount] = useState<string>(
    plan?.expectedCount != null ? String(plan.expectedCount) : ""
  );
  const [memo, setMemo] = useState(plan?.memo ?? "");
  const [saving, setSaving] = useState(false);

  // 実績記録（計画をそのまま RpaScoutLog 化する）
  const executed = !!plan?.executedAt;
  const [searchCount, setSearchCount] = useState<string>("");
  const [recordedAt, setRecordedAt] = useState(nowJstDateTimeLocal());
  const [executing, setExecuting] = useState(false);

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

  const selectedPattern = patterns.find((p) => p.id === patternId);

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
      body: JSON.stringify({
        ...(isNew ? { planDate: date, machineNo } : {}),
        timeSlot,
        patternId,
        subjectTemplateId,
        expectedCount: expectedCount === "" ? null : Number(expectedCount),
        memo,
      }),
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

  const execute = async () => {
    if (!plan || executed) return;
    if (!recordedAt) {
      toast.error("記録日時を入力してください");
      return;
    }
    setExecuting(true);
    const res = await fetch(`/api/rpa-scout/plans/${plan.id}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchCount: searchCount === "" ? null : Number(searchCount),
        recordedAt,
      }),
    });
    setExecuting(false);
    if (res.ok) {
      toast.success("実績として記録しました");
      onSaved();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "実績の記録に失敗しました");
    }
  };

  const cancelExecution = async () => {
    if (!plan || !executed) return;
    if (!confirm("実績の記録を取り消しますか？\n変更ログから該当の1件が削除されます。")) return;
    setExecuting(true);
    const res = await fetch(`/api/rpa-scout/plans/${plan.id}/execute`, { method: "DELETE" });
    setExecuting(false);
    if (res.ok) {
      toast.success("実績の記録を取り消しました");
      onSaved();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "取り消しに失敗しました");
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
                  <option
                    key={p.id}
                    value={p.id}
                    style={isRecentlyUsed(p.lastUsedAt) ? { color: "#DC2626" } : undefined}
                  >
                    {displayPatternName(p.targetMachineNo, p.name)} {lastUsedSuffix(p)}
                  </option>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="────── 他号機用 ──────">
                  {others.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      style={isRecentlyUsed(p.lastUsedAt) ? { color: "#DC2626" } : undefined}
                    >
                      {displayPatternName(p.targetMachineNo, p.name)} {lastUsedSuffix(p)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <LastUsedNote pattern={selectedPattern} />
          </div>

          <div>
            <label className={label}>件名テンプレート</label>
            <SubjectTemplateSelect
              templates={templates}
              value={subjectTemplateId}
              onChange={setSubjectTemplateId}
              sendStatus={selectedPattern?.sendStatus ?? null}
            />
          </div>

          <div>
            <label className={label}>想定件数（任意）</label>
            <input
              type="number"
              min={0}
              value={expectedCount}
              onChange={(e) => setExpectedCount(e.target.value)}
              placeholder="例: 300"
              className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
            />
            <div className="mt-1 text-[11px] text-[#6B7280]">
              この条件で何件ヒットする想定か。実績と突き合わせて予実管理に使います。
            </div>
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

          {/* 計画どおり実行した場合、ここから直接 変更ログ（実績）を作る。計画は残す */}
          {!isNew && (
            <div className="space-y-3 border-t pt-4">
              <div className="text-[13px] font-bold text-[#374151]">実績として記録</div>

              {executed ? (
                <>
                  <div className="rounded-[6px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-[13px] text-[#166534]">
                    <div className="font-semibold">✓ 実施済み</div>
                    <div className="mt-1 text-[12px]">
                      記録日時: {fmtJstDateTime(plan!.executedAt!)}
                      <br />
                      検索件数:{" "}
                      {plan!.executedSearchCount != null
                        ? `${plan!.executedSearchCount.toLocaleString()}件`
                        : "停止（件数なし）"}
                      {plan!.expectedCount != null && (
                        <>
                          （想定 {plan!.expectedCount.toLocaleString()}件
                          {plan!.executedSearchCount != null &&
                            `・達成率 ${achievementPct(plan!.executedSearchCount, plan!.expectedCount)}%`}
                          ）
                        </>
                      )}
                      {plan!.executedByName ? <br /> : null}
                      {plan!.executedByName ? `記録者: ${plan!.executedByName}` : null}
                    </div>
                  </div>
                  <button
                    onClick={cancelExecution}
                    disabled={executing}
                    className="rounded-[6px] border border-[#FCA5A5] px-3 py-1.5 text-[13px] text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50"
                  >
                    {executing ? "処理中..." : "実績の記録を取り消す"}
                  </button>
                </>
              ) : (
                <>
                  <div className="text-[12px] text-[#6B7280]">
                    この計画の号機・パターン・件名のまま、変更ログに1件記録します（計画は残ります）。
                  </div>
                  <div>
                    <label className={label}>
                      検索件数（空欄=停止記録）
                      {plan!.expectedCount != null && (
                        <span className="ml-2 font-normal text-[#2563EB]">
                          想定 {plan!.expectedCount.toLocaleString()}件
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={searchCount}
                      onChange={(e) => setSearchCount(e.target.value)}
                      placeholder="例: 850"
                      className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className={label}>記録日時</label>
                    <input
                      type="datetime-local"
                      value={recordedAt}
                      onChange={(e) => setRecordedAt(e.target.value)}
                      className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
                    />
                  </div>
                  <button
                    onClick={execute}
                    disabled={executing}
                    className="rounded-[6px] bg-[#16A34A] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50"
                  >
                    {executing ? "記録中..." : "この内容で実績を記録"}
                  </button>
                </>
              )}
            </div>
          )}
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { addDaysYmd, mondayOfWeek, nowJstYmd, ymdWeekday } from "@/lib/rpa-scout/jst";
import { timeSlotLabel, TIME_SLOT_ORDER, MACHINE_NOS } from "@/lib/rpa-scout/constants";
import {
  fmtJstDate,
  fmtJstDateTime,
  fmtJstTime,
  recordedByLabel,
  type RpaLog,
  type RpaMachine,
  type RpaPattern,
  type RpaPlan,
  type RpaTemplate,
} from "./types";
import PlanModal from "./PlanModal";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const SLOT_BADGE: Record<string, string> = {
  AM: "bg-[#DBEAFE] text-[#1D4ED8]",
  PM: "bg-[#DCFCE7] text-[#166534]",
  EVENING: "bg-[#EDE9FE] text-[#6D28D9]",
};

function isWeekend(ymd: string): boolean {
  const wd = ymdWeekday(ymd);
  return wd === 0 || wd === 6;
}

export default function CalendarClient() {
  const today = nowJstYmd();
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState(today); // 表示基準日（JST ymd）
  const [plans, setPlans] = useState<RpaPlan[]>([]);
  const [logs, setLogs] = useState<RpaLog[]>([]);
  const [showLogs, setShowLogs] = useState(true); // 「実績を表示」トグル（デフォルトON）
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [pending, setPending] = useState<RpaPlan[]>([]);
  const [patterns, setPatterns] = useState<RpaPattern[]>([]);
  const [templates, setTemplates] = useState<RpaTemplate[]>([]);
  const [machines, setMachines] = useState<RpaMachine[]>([]); // 件名の「現在」判定用
  const [modal, setModal] = useState<
    | { mode: "create"; date: string; machineNo: number }
    | { mode: "edit"; plan: RpaPlan }
    | null
  >(null);

  // 表示範囲（週表示は月曜始まり。週の境界判定もJSTのymd文字列演算で行う＝罠#17対応）
  const days = useMemo(() => {
    if (viewMode === "day") return [anchor];
    const monday = mondayOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
  }, [viewMode, anchor]);

  const loadPlans = useCallback(async () => {
    const res = await fetch(`/api/rpa-scout/plans?from=${days[0]}&to=${days[days.length - 1]}`);
    if (res.ok) setPlans((await res.json()).plans);
  }, [days]);

  // 実績（変更ログ）は表示範囲を1リクエストで取り切る（セルごとにfetchしない）
  const loadLogs = useCallback(async () => {
    const res = await fetch(
      `/api/rpa-scout/logs?from=${days[0]}&to=${days[days.length - 1]}&limit=500&sort=recordedAt&order=asc`
    );
    if (res.ok) setLogs((await res.json()).logs);
  }, [days]);

  const loadPending = useCallback(async () => {
    const from = addDaysYmd(nowJstYmd(), -14);
    const to = addDaysYmd(nowJstYmd(), 14);
    const res = await fetch(`/api/rpa-scout/plans?from=${from}&to=${to}&pendingWeekend=1`);
    if (res.ok) setPending((await res.json()).plans);
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // 各号機の最新ログ（件名の「現在」判定に使う）。実績記録で変わるため reload でも取り直す
  const loadMachines = useCallback(async () => {
    const res = await fetch("/api/rpa-scout/machines");
    if (res.ok) setMachines((await res.json()).machines);
  }, []);

  useEffect(() => {
    loadPending();
    loadMachines();
    (async () => {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/rpa-scout/patterns"),
        fetch("/api/rpa-scout/templates"),
      ]);
      if (pRes.ok) setPatterns((await pRes.json()).patterns);
      if (tRes.ok) setTemplates((await tRes.json()).templates);
    })();
  }, [loadPending, loadMachines]);

  const reload = () => {
    loadPlans();
    loadPending();
    loadLogs(); // 実績記録／取り消しで変更ログ側も変わるため一緒に取り直す
    loadMachines();
  };

  const move = (dir: -1 | 1) => {
    setAnchor(addDaysYmd(anchor, viewMode === "week" ? dir * 7 : dir));
  };

  const toggleReflected = async (plan: RpaPlan, reflected: boolean) => {
    const res = await fetch(`/api/rpa-scout/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reflected }),
    });
    if (res.ok) {
      toast.success(reflected ? "反映済みにしました" : "反映チェックを外しました");
      reload();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "更新に失敗しました");
    }
  };

  // 実績記録の取り消し。実績チップ側からのみ辿れる（実施済みの計画チップは出さないため）
  const cancelExecution = async (log: RpaLog) => {
    if (!log.sourcePlan) return;
    if (!confirm("実績の記録を取り消しますか？\n変更ログから該当の1件が削除され、計画が未実施に戻ります。"))
      return;
    const res = await fetch(`/api/rpa-scout/plans/${log.sourcePlan.id}/execute`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("実績の記録を取り消しました");
      setExpandedLogId(null);
      reload();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "取り消しに失敗しました");
    }
  };

  // そのマス（日付×号機）の全計画。実施済みも含む＝時間帯の重複警告はこちらを基準にする
  const allPlansFor = (date: string, machineNo: number) =>
    plans
      .filter((p) => fmtJstDate(p.planDate) === date && p.machineNo === machineNo)
      .sort((a, b) => (TIME_SLOT_ORDER[a.timeSlot] ?? 9) - (TIME_SLOT_ORDER[b.timeSlot] ?? 9));

  // 実績記録済みの計画は実績チップが同じ内容を表すため、計画チップは出さない（レコードは残す）
  const plansFor = (date: string, machineNo: number) =>
    allPlansFor(date, machineNo).filter((p) => !p.executedAt);

  // 実績は記録時刻の昇順で縦積み
  const logsFor = (date: string, machineNo: number) =>
    logs
      .filter((l) => fmtJstDate(l.recordedAt) === date && l.machineNo === machineNo)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return (
    <div>
      <Toaster position="top-center" richColors />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>配信計画カレンダー</PageTitle>
        <div className="flex items-center gap-2 text-[13px]">
          <button
            onClick={() => move(-1)}
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 hover:bg-[#F9FAFB]"
          >
            ← {viewMode === "week" ? "前週" : "前日"}
          </button>
          <button
            onClick={() => setAnchor(today)}
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 hover:bg-[#F9FAFB]"
          >
            今日
          </button>
          <button
            onClick={() => move(1)}
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 hover:bg-[#F9FAFB]"
          >
            {viewMode === "week" ? "翌週" : "翌日"} →
          </button>
          <label className="ml-2 flex items-center gap-1.5 rounded-[6px] border border-[#D1D5DB] px-3 py-1.5">
            <input
              type="checkbox"
              checked={showLogs}
              onChange={(e) => setShowLogs(e.target.checked)}
            />
            実績を表示
          </label>
          <div className="flex overflow-hidden rounded-[6px] border border-[#D1D5DB]">
            <button
              onClick={() => setViewMode("week")}
              className={
                viewMode === "week"
                  ? "bg-[#2563EB] px-3 py-1.5 font-medium text-white"
                  : "px-3 py-1.5 hover:bg-[#F9FAFB]"
              }
            >
              週
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={
                viewMode === "day"
                  ? "bg-[#2563EB] px-3 py-1.5 font-medium text-white"
                  : "px-3 py-1.5 hover:bg-[#F9FAFB]"
              }
            >
              日
            </button>
          </div>
        </div>
      </div>

      {/* 土日 反映待ちバナー */}
      {pending.length > 0 && (
        <div className="mb-4 rounded-[8px] border border-[#FCD34D] bg-[#FFFBEB] p-3">
          <div className="mb-2 text-[13px] font-bold text-[#92400E]">
            ⚠ 土日 反映待ち（{pending.length}件）
          </div>
          <div className="space-y-1">
            {pending.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-2 text-[13px] text-[#374151]"
              >
                <span className="font-medium">
                  {fmtJstDate(p.planDate)}（{WEEKDAY_LABELS[ymdWeekday(fmtJstDate(p.planDate))]}）
                </span>
                <span>{p.machineNo}号機</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SLOT_BADGE[p.timeSlot] ?? ""}`}
                >
                  {timeSlotLabel(p.timeSlot)}
                </span>
                <span className="break-all">{p.patternName}</span>
                <button
                  onClick={() => toggleReflected(p, true)}
                  className="rounded border border-[#D97706] px-2 py-0.5 text-[12px] font-medium text-[#B45309] hover:bg-[#FEF3C7]"
                >
                  マイナビ反映済みにする
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-[8px] border border-[#E5E7EB] bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="w-20 border-b border-r border-[#E5E7EB] bg-white px-2 py-2 text-left text-[12px] font-semibold text-[#374151]/80">
                号機
              </th>
              {days.map((d) => {
                const weekend = isWeekend(d);
                const isToday = d === today;
                return (
                  <th
                    key={d}
                    className={[
                      "border-b border-r border-[#E5E7EB] px-2 py-2 text-center text-[12px] font-semibold",
                      weekend ? "bg-[#FFF7ED]" : "bg-white",
                      isToday ? "text-[#2563EB]" : "text-[#374151]/80",
                    ].join(" ")}
                  >
                    {d.slice(5).replace("-", "/")}（{WEEKDAY_LABELS[ymdWeekday(d)]}）
                    {isToday && <span className="ml-1 text-[10px]">今日</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {MACHINE_NOS.map((no) => (
              <tr key={no}>
                <td className="border-b border-r border-[#E5E7EB] bg-[#F9FAFB] px-2 py-2 align-top font-medium text-[#374151]">
                  {no}号機
                </td>
                {days.map((d) => {
                  const weekend = isWeekend(d);
                  const cellPlans = plansFor(d, no);
                  const cellLogs = showLogs ? logsFor(d, no) : [];
                  return (
                    <td
                      key={d}
                      onClick={() => setModal({ mode: "create", date: d, machineNo: no })}
                      className={[
                        "min-w-[130px] cursor-pointer border-b border-r border-[#E5E7EB] p-1 align-top",
                        weekend ? "bg-[#FFF7ED] hover:bg-[#FFEDD5]" : "hover:bg-[#F9FAFB]",
                      ].join(" ")}
                    >
                      <div className="min-h-[48px] space-y-1">
                        {/* 実績チップ（表示専用・グレー系）。クリックしても編集モーダルは開かない */}
                        {cellLogs.map((l) => {
                          const expanded = expandedLogId === l.id;
                          const recordedBy = recordedByLabel(l);
                          return (
                            <div
                              key={l.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedLogId(expanded ? null : l.id);
                              }}
                              title={`${fmtJstDateTime(l.recordedAt)}｜${l.patternName}｜${l.subjectName}｜${
                                l.searchCount != null ? `${l.searchCount.toLocaleString()}件` : "停止"
                              }${recordedBy ? `｜${recordedBy}` : ""}`}
                              className="rounded border border-[#D1D5DB] bg-[#F3F4F6] p-1"
                            >
                              <div className="flex items-center gap-1">
                                <span className="rounded bg-[#E5E7EB] px-1 text-[10px] font-bold text-[#4B5563]">
                                  実績
                                </span>
                                <span className="text-[10px] font-medium text-[#4B5563]">
                                  {fmtJstTime(l.recordedAt)}
                                </span>
                                <span className="ml-auto text-[10px] font-semibold text-[#374151]">
                                  {l.searchCount != null ? `${l.searchCount.toLocaleString()}件` : "停止"}
                                </span>
                              </div>
                              <div
                                className={[
                                  "mt-0.5 text-[11px] text-[#4B5563]",
                                  expanded ? "break-all" : "truncate",
                                ].join(" ")}
                              >
                                {l.patternName}
                              </div>
                              {expanded && (
                                <div className="mt-0.5 break-all text-[10px] text-[#6B7280]">
                                  {l.subjectName}
                                  {recordedBy ? `（${recordedBy}）` : ""}
                                </div>
                              )}
                              {/* 計画から記録された実績のみ、取り消し導線を出す（計画チップは非表示のため） */}
                              {expanded && l.sourcePlan && (
                                <div className="mt-1 border-t border-[#E5E7EB] pt-1">
                                  <div className="text-[10px] text-[#6B7280]">
                                    この実績は配信計画から記録されました（
                                    {timeSlotLabel(l.sourcePlan.timeSlot)}
                                    {l.sourcePlan.expectedCount != null &&
                                      `・想定 ${l.sourcePlan.expectedCount.toLocaleString()}件`}
                                    ）
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelExecution(l);
                                    }}
                                    className="mt-1 rounded border border-[#FCA5A5] px-1.5 py-0.5 text-[10px] text-[#DC2626] hover:bg-[#FEF2F2]"
                                  >
                                    実績の記録を取り消す
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* 計画チップ（未実施のみ）。実績記録済みは実績チップが表すため出さない */}
                        {cellPlans.map((p) => (
                          <div
                            key={p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setModal({ mode: "edit", plan: p });
                            }}
                            className="rounded border border-[#BFDBFE] bg-[#F5F9FF] p-1 shadow-sm hover:border-[#60A5FA]"
                          >
                            <div className="flex items-center gap-1">
                              <span className="rounded bg-[#DBEAFE] px-1 text-[10px] font-bold text-[#1E40AF]">
                                計画
                              </span>
                              <span
                                className={`rounded px-1 text-[10px] font-bold ${SLOT_BADGE[p.timeSlot] ?? ""}`}
                              >
                                {timeSlotLabel(p.timeSlot)}
                              </span>
                              {/* 反映済みバッジは曜日を問わず出す（平日はRPAが外部APIで反映するため）。
                                  反映者nullは外部API（RPA）からの反映＝人が押していない */}
                              {p.reflectedAt && (
                                <span
                                  title={`${p.reflectedByName ?? "RPA自動"} が ${fmtJstDateTime(p.reflectedAt)} に反映`}
                                  className="rounded bg-[#DCFCE7] px-1 text-[10px] font-medium text-[#166534]"
                                >
                                  ✓反映済
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] font-medium text-[#374151]">
                              {p.patternName}
                            </div>
                            <div className="truncate text-[10px] text-[#6B7280]">
                              {p.subjectName}
                            </div>
                            {p.expectedCount != null && (
                              <div className="mt-0.5 text-[10px] font-medium text-[#1D4ED8] tabular-nums">
                                予定 {p.expectedCount.toLocaleString()}件
                              </div>
                            )}
                            {weekend && (
                              <label
                                onClick={(e) => e.stopPropagation()}
                                className="mt-0.5 flex items-center gap-1 text-[10px] text-[#6B7280]"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!p.reflectedAt}
                                  onChange={(e) => toggleReflected(p, e.target.checked)}
                                />
                                マイナビ反映済み
                              </label>
                            )}
                          </div>
                        ))}

                        {/* 追加導線。チップがマスを埋めても必ず押せるよう常時表示する
                            （以前はマスの余白クリックだけが導線で、チップで埋まると新規作成できなかった） */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ mode: "create", date: d, machineNo: no });
                          }}
                          className="w-full rounded border border-dashed border-[#D1D5DB] py-0.5 text-[11px] text-[#9CA3AF] hover:border-[#60A5FA] hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                        >
                          ＋ 追加
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        // siblingPlans = 同じマスの他の計画（自分自身は除く）。時間帯が重複したら保存前に警告する
        <PlanModal
          {...(modal.mode === "create"
            ? { plan: null, presetDate: modal.date, presetMachineNo: modal.machineNo }
            : { plan: modal.plan, presetDate: null, presetMachineNo: null })}
          siblingPlans={
            modal.mode === "create"
              ? allPlansFor(modal.date, modal.machineNo)
              : allPlansFor(fmtJstDate(modal.plan.planDate), modal.plan.machineNo).filter(
                  (p) => p.id !== modal.plan.id
                )
          }
          patterns={patterns}
          templates={templates}
          machines={machines}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

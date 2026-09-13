"use client";

// T-194: スカウト配信条件コンソール（画面本体）
// 左=絞り込みパネル（380px）／右=一覧（列表示・横スクロール）。一覧上部に「前日｜当日｜翌日｜すべて」。
// 行クリックで右から詳細パネル。複数選択で複製・削除・CSV。
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";
import { SORT_OPTIONS, type SortKey } from "@/lib/scout-conditions/constants";
import {
  addDaysYmd,
  formatYmdShort,
  jstTodayYmd,
  dayKind,
  dayColorClass,
  type HolidayMap,
} from "@/lib/scout-conditions/dates";
import type { ConditionDto, ConditionsResponse } from "@/lib/scout-conditions/types";
import ConditionTable from "./ConditionTable";
import DetailPanel, { type DetailMode } from "./DetailPanel";
import FilterPanel from "./FilterPanel";
import PrefectureModal from "./PrefectureModal";
import { applyDayFilter, applyFilter, buildCsv, DEFAULT_FILTER, sortConditions, type DayFilter, type FilterState } from "./filter";

type PrefModalState = { initial: string[]; onConfirm: (prefs: string[]) => void } | null;

export default function ConditionsClient() {
  const [data, setData] = useState<ConditionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<FilterState>(DEFAULT_FILTER);
  const [applied, setApplied] = useState<FilterState>(DEFAULT_FILTER);
  const [day, setDay] = useState<DayFilter>("today");
  const [sortKey, setSortKey] = useState<SortKey>("machine");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DetailMode | null>(null);
  const [prefModal, setPrefModal] = useState<PrefModalState>(null);

  const today = jstTodayYmd();
  const dayYmd = useMemo<Record<Exclude<DayFilter, "all">, string>>(
    () => ({ prev: addDaysYmd(today, -1), today, next: addDaysYmd(today, 1) }),
    [today],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scout/conditions", { cache: "no-store" });
      if (!res.ok) {
        toast.error("読み込みに失敗しました");
        return;
      }
      setData((await res.json()) as ConditionsResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const holidays: HolidayMap = useMemo(
    () => Object.fromEntries((data?.holidays ?? []).map((h) => [h.date, h.name])),
    [data?.holidays],
  );
  const conditions = useMemo(() => data?.conditions ?? [], [data?.conditions]);

  // 該当件数は左パネルの下書き（draft）に即時追従。一覧は「検索」で確定した applied を使う
  const draftCount = useMemo(
    () => applyDayFilter(applyFilter(conditions, draft), day, day === "all" ? null : dayYmd[day]).length,
    [conditions, draft, day, dayYmd],
  );
  const rows = useMemo(
    () => sortConditions(applyDayFilter(applyFilter(conditions, applied), day, day === "all" ? null : dayYmd[day]), sortKey),
    [conditions, applied, day, dayYmd, sortKey],
  );

  // T-195: 予約切れの警告帯（稼働中の号機ごとに QUEUED が0件なら出す）。
  // 「ポータルタスク作成済」は実際に未完了タスクがあるときだけ表示し、リンクは実タスクに向ける。
  const emptyQueueMachines = useMemo(() => {
    if (!data) return [];
    return data.machines
      .filter((m) => m.isActive)
      .filter((m) => !conditions.some((c) => c.machineId === m.id && c.status === "QUEUED"))
      .map((m) => ({ machineNo: m.machineNo, task: m.queueEmptyTask }));
  }, [data, conditions]);

  // T-195: 号機内の予約列（queueOrder 昇順→登録順）での先頭／末尾。絞り込み前の全件から計算する
  const queueBounds = useMemo(() => {
    const byMachine = new Map<string, ConditionDto[]>();
    for (const c of conditions) {
      if (c.status !== "QUEUED") continue;
      const list = byMachine.get(c.machineId) ?? [];
      list.push(c);
      byMachine.set(c.machineId, list);
    }
    const out: Record<string, { canUp: boolean; canDown: boolean }> = {};
    for (const list of byMachine.values()) {
      list.sort((a, b) => a.queueOrder - b.queueOrder || a.createdAt.localeCompare(b.createdAt));
      list.forEach((c, i) => {
        out[c.id] = { canUp: i > 0, canDown: i < list.length - 1 };
      });
    }
    return out;
  }, [conditions]);

  const move = async (c: ConditionDto, direction: "up" | "down") => {
    const res = await fetch("/api/scout/conditions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", id: c.id, direction }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "並べ替えに失敗しました");
      return;
    }
    for (const x of json.conditions as ConditionDto[]) upsertLocal(x);
  };

  // 詳細パネルは最新の行を参照する（保存後の updatedAt 変化でフォームが入れ替わる）
  const detailMode: DetailMode | null = useMemo(() => {
    if (!detail) return null;
    if (detail.kind === "new") return detail;
    const latest = conditions.find((c) => c.id === detail.condition.id);
    return latest ? { kind: "edit", condition: latest } : null;
  }, [detail, conditions]);

  const upsertLocal = (c: ConditionDto) =>
    setData((d) => {
      if (!d) return d;
      const exists = d.conditions.some((x) => x.id === c.id);
      return { ...d, conditions: exists ? d.conditions.map((x) => (x.id === c.id ? c : x)) : [...d.conditions, c] };
    });
  const removeLocal = (ids: string[]) => {
    const set = new Set(ids);
    setData((d) => (d ? { ...d, conditions: d.conditions.filter((x) => !set.has(x.id)) } : d));
    setSelected((s) => new Set([...s].filter((id) => !set.has(id))));
    setDetail((m) => (m && m.kind === "edit" && set.has(m.condition.id) ? null : m));
  };

  const bulk = async (action: "duplicate" | "delete", ids: string[]) => {
    if (ids.length === 0) return;
    if (action === "delete") {
      // T-195: 実績がある条件は削除不可。事前に弾けるものは弾き、残りはサーバー側で飛ばして件数を報告する
      const withRuns = conditions.filter((c) => ids.includes(c.id) && c.runs.length > 0);
      if (withRuns.length === ids.length) {
        toast.error("実績があるため削除できません（状態を「完了」にしてください）");
        return;
      }
      const note = withRuns.length ? `（実績がある${withRuns.length}件は削除されません）` : "";
      if (!window.confirm(`${ids.length - withRuns.length}件の条件を削除します${note}。よろしいですか？`)) return;
    }
    const res = await fetch("/api/scout/conditions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "操作に失敗しました");
      return;
    }
    if (action === "delete") {
      const deletedIds: string[] = Array.isArray(json.deletedIds) ? json.deletedIds : ids;
      removeLocal(deletedIds);
      const skipped = Number(json.skipped ?? 0);
      toast.success(`${json.deleted ?? deletedIds.length}件を削除しました${skipped ? `（実績がある${skipped}件は削除していません）` : ""}`);
    } else {
      for (const c of json.conditions as ConditionDto[]) upsertLocal(c);
      toast.success(`${(json.conditions as ConditionDto[]).length}件を予約として複製しました`);
    }
  };

  const downloadCsv = (ids: string[]) => {
    const target = ids.length ? rows.filter((r) => ids.includes(r.id)) : rows;
    if (target.length === 0) {
      toast.error("出力する行がありません");
      return;
    }
    const blob = new Blob([buildCsv(target)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scout-conditions_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const DAY_BUTTONS: { key: DayFilter; label: string }[] = [
    { key: "prev", label: "前日" },
    { key: "today", label: "当日" },
    { key: "next", label: "翌日" },
    { key: "all", label: "すべて" },
  ];

  return (
    <div>
      <Toaster position="top-center" richColors />
      <ScoutNav />
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#374151]">スカウト配信条件</h1>
          <p className="mt-1 text-[13px] text-[#6B7280]">
            号機ごとのマイナビ検索条件（6軸）と予約・配信テンプレートを管理します。RPA はここで持つ条件をフォームへ直接入力します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDetail({ kind: "new" })}
          className="rounded-[6px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
        >
          ＋ 条件を新規作成
        </button>
      </div>

      {emptyQueueMachines.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#FCD34D] bg-[#FFFBEB] px-4 py-2.5 text-[13px] text-[#92400E]">
          <div>
            <span className="mr-1 font-semibold">
              ⚠ {emptyQueueMachines.map((m) => `${m.machineNo}号機`).join("・")}の予約が空です。
            </span>
            枯渇しても切り替える条件が無く、現在の条件のまま配信を続けます。次の条件を予約してください。
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {emptyQueueMachines.map((m) =>
              m.task ? (
                <Link
                  key={m.machineNo}
                  href={`/tasks/${m.task.id}`}
                  title={m.task.title}
                  className="rounded bg-white px-2 py-0.5 text-[#2563EB] underline"
                >
                  {m.machineNo}号機：ポータルタスク作成済
                </Link>
              ) : (
                <span key={m.machineNo} className="rounded bg-white px-2 py-0.5 text-[#6B7280]">
                  {m.machineNo}号機：枯渇時に LINE WORKS 通知＋タスク作成
                </span>
              ),
            )}
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        {data && (
          <FilterPanel
            filter={draft}
            onChange={setDraft}
            machines={data.machines}
            holidays={holidays}
            currentYear={Number(today.slice(0, 4))}
            count={draftCount}
            onReset={() => {
              setDraft(DEFAULT_FILTER);
              setApplied(DEFAULT_FILTER);
            }}
            onSearch={() => {
              setApplied(draft);
              void load();
            }}
            onOpenPrefModal={() =>
              setPrefModal({
                initial: draft.prefectures,
                onConfirm: (prefs) => setDraft((f) => ({ ...f, prefectures: prefs })),
              })
            }
          />
        )}

        <div className="min-w-0 flex-1 rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          {/* 日付切替 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-3">
            <div className="flex gap-1">
              {DAY_BUTTONS.map((b) => {
                const ymd = b.key === "all" ? null : dayYmd[b.key];
                const kind = ymd ? dayKind(ymd, holidays) : "weekday";
                const active = day === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setDay(b.key)}
                    title={ymd && holidays[ymd] ? holidays[ymd] : undefined}
                    className={[
                      "rounded-[6px] border px-3 py-1.5 text-[13px] transition-colors",
                      active ? "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#1D4ED8]" : "border-[#D1D5DB] text-[#374151] hover:bg-[#F9FAFB]",
                    ].join(" ")}
                  >
                    {b.label}
                    {ymd && (
                      <span className={`ml-1 text-[12px] ${active ? "" : dayColorClass(kind)}`}>
                        {formatYmdShort(ymd)}
                        {holidays[ymd] ? "祝" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
              <span>並び順</span>
              <select
                className="rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1 text-[12px] text-[#374151]"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ツールバー */}
          <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2 text-[12px]">
            <span className="text-[#374151]">
              選択 <span className="font-semibold">{selected.size}</span> 件 / 表示 {rows.length} 件
            </span>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => bulk("duplicate", [...selected])}
              className="rounded border border-[#D1D5DB] bg-white px-2 py-1 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40"
            >
              複製
            </button>
            <button
              type="button"
              onClick={() => downloadCsv([...selected])}
              className="rounded border border-[#D1D5DB] bg-white px-2 py-1 text-[#374151] hover:bg-[#F3F4F6]"
              title={selected.size ? "選択した行を出力" : "表示中の全行を出力"}
            >
              CSVダウンロード{selected.size ? `（${selected.size}件）` : "（表示中）"}
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => bulk("delete", [...selected])}
              className="rounded border border-[#FECACA] bg-white px-2 py-1 text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-40"
            >
              削除
            </button>
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="text-[#6B7280] underline">
                選択解除
              </button>
            )}
            <span className="ml-auto text-[11px] text-[#9CA3AF]">送信件数が10件未満の行は枯渇として赤く表示します</span>
          </div>

          {loading && !data ? (
            <div className="px-4 py-10 text-center text-[13px] text-[#9CA3AF]">読み込み中…</div>
          ) : (
            <ConditionTable
              rows={rows}
              holidays={holidays}
              selected={selected}
              activeId={detailMode?.kind === "edit" ? detailMode.condition.id : null}
              onToggle={(id) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
              onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())}
              onRowClick={(c) => setDetail({ kind: "edit", condition: c })}
              onDuplicate={(c) => bulk("duplicate", [c.id])}
              onDelete={(c) => bulk("delete", [c.id])}
              onMove={move}
              queueBounds={queueBounds}
            />
          )}
        </div>
      </div>

      {detailMode && data && (
        <DetailPanel
          mode={detailMode}
          machines={data.machines}
          templates={data.templates}
          holidays={holidays}
          onClose={() => setDetail(null)}
          onSaved={(c, isNew) => {
            upsertLocal(c);
            if (isNew) setDetail({ kind: "edit", condition: c });
          }}
          onDuplicate={(c) => bulk("duplicate", [c.id])}
          onDelete={(c) => bulk("delete", [c.id])}
          onOpenPrefModal={(current, onConfirm) => setPrefModal({ initial: current, onConfirm })}
        />
      )}

      {prefModal && (
        <PrefectureModal
          initial={prefModal.initial}
          onClose={() => setPrefModal(null)}
          onConfirm={(prefs) => {
            prefModal.onConfirm(prefs);
            setPrefModal(null);
          }}
        />
      )}
    </div>
  );
}

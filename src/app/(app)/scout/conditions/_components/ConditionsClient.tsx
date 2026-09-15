"use client";

// T-194: スカウト配信条件コンソール（画面本体）
// T-197: 「条件を組んで登録する」画面に一本化。左の絞り込みパネルは廃止し、
//   ヘッダーの「検索設定」（新規）と各行の「条件設定」（編集）から同じ中央モーダルを開く。
//   一覧上部の「前日｜当日｜翌日｜すべて」と並び順はそのまま。複数選択で複製・削除・CSV。
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";
import { SORT_OPTIONS, conditionStatusLabel, type SortKey } from "@/lib/scout-conditions/constants";
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
import ConditionModal, { type ModalMode } from "./ConditionModal";
import PrefectureModal from "./PrefectureModal";
import { applyDayFilter, buildCsv, sortConditions, type DayFilter } from "./filter";

type PrefModalState = { initial: string[]; title: string; onConfirm: (prefs: string[]) => void } | null;

export default function ConditionsClient() {
  const [data, setData] = useState<ConditionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<DayFilter>("today");
  const [sortKey, setSortKey] = useState<SortKey>("machine");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalMode | null>(null);
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

  const rows = useMemo(
    () => sortConditions(applyDayFilter(conditions, day, day === "all" ? null : dayYmd[day]), sortKey),
    [conditions, day, dayYmd, sortKey],
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

  // T-197: 稼働中なのに実行中が1件も無い号機（RPA が条件を取れず配信が走らない）
  const noRunningMachines = useMemo(() => {
    if (!data) return [];
    return data.machines
      .filter((m) => m.isActive)
      .filter((m) => !conditions.some((c) => c.machineId === m.id && c.status === "RUNNING"))
      .map((m) => m.machineNo);
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

  // モーダルは最新の行を参照する（保存後の updatedAt 変化でフォームが入れ替わる）
  const modalMode: ModalMode | null = useMemo(() => {
    if (!modal) return null;
    if (modal.kind === "new") return modal;
    const latest = conditions.find((c) => c.id === modal.condition.id);
    return latest ? { kind: "edit", condition: latest } : null;
  }, [modal, conditions]);

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
    setModal((m) => (m && m.kind === "edit" && set.has(m.condition.id) ? null : m));
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
      const created = json.conditions as ConditionDto[];
      for (const c of created) upsertLocal(c);
      // T-197: 複製も自動決定（実行中が無ければ実行中、あれば予約の末尾）なので結果の状態を伝える
      const summary = created.map((c) => `${c.recordNo ?? ""}(${conditionStatusLabel(c.status)})`).join("・");
      toast.success(`${created.length}件を複製しました：${summary}`);
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
            号機ごとのマイナビ検索条件（7軸）と配信テンプレートを登録します。RPA は「実行中」の条件をフォームへ直接入力します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: "new" })}
          className="rounded-[6px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
        >
          検索設定
        </button>
      </div>

      {noRunningMachines.length > 0 && (
        <div className="mb-3 rounded-[8px] border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2.5 text-[13px] text-[#991B1B]">
          <span className="mr-1 font-semibold">⚠ {noRunningMachines.map((n) => `${n}号機`).join("・")}に「実行中」の条件がありません。</span>
          RPA は実行中の条件しか取得しないため配信が走りません。「検索設定」から条件を登録すると自動で実行中になります。
        </div>
      )}

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

      <div className="min-w-0 rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* 日付切替 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-3">
          <div className="flex items-center gap-1">
            {/* T-198: この切替が見ているのは配信日（作成日ではない）。基準を画面上でも明記する */}
            <span className="mr-1 text-[12px] text-[#6B7280]">配信日</span>
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
            <button type="button" onClick={() => void load()} className="ml-2 text-[#2563EB] underline" title="最新の状態を読み直す">
              再読込
            </button>
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
            onToggle={(id) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())}
            onEdit={(c) => setModal({ kind: "edit", condition: c })}
            onDuplicate={(c) => bulk("duplicate", [c.id])}
            onDelete={(c) => bulk("delete", [c.id])}
            onMove={move}
            queueBounds={queueBounds}
          />
        )}
      </div>

      {modalMode && data && (
        <ConditionModal
          mode={modalMode}
          machines={data.machines}
          templates={data.templates}
          conditions={conditions}
          holidays={holidays}
          onClose={() => setModal(null)}
          onSaved={(c, isNew, demoted) => {
            upsertLocal(c);
            // T-198: 実行中を1件に保つため「完了」へ畳まれた行も反映する（再読込しなくても一覧が合う）
            for (const d of demoted) upsertLocal(d);
            if (isNew) setModal({ kind: "edit", condition: c });
          }}
          onDuplicate={(c) => bulk("duplicate", [c.id])}
          onDelete={(c) => bulk("delete", [c.id])}
          onOpenPrefModal={(current, onConfirm, title) => setPrefModal({ initial: current, title, onConfirm })}
        />
      )}

      {prefModal && (
        <PrefectureModal
          initial={prefModal.initial}
          title={prefModal.title}
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

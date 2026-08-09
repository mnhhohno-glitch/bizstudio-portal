"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { displayPatternName, machineLabel } from "@/lib/rpa-scout/pattern-name";
import { AREA_TYPE_LABELS } from "@/lib/rpa-scout/area";
import {
  fmtJstShortDateTime,
  fmtUtcInstantAsJstDate,
  isRecentlyUsed,
  type JobCategoryRow,
  type RpaPattern,
} from "./types";
import PatternFormModal from "./PatternFormModal";

// フォームの開き方。duplicate は複製元の条件を初期値に持つ新規作成（複製元は書き換えない）
type FormState =
  | { mode: "new" }
  | { mode: "edit"; pattern: RpaPattern }
  | { mode: "duplicate"; pattern: RpaPattern; sourceName: string };

type SortKey =
  | "machine"
  | "name"
  | "sendStatus"
  | "regist"
  | "area"
  | "gradYear"
  | "companyCount"
  | "jobCategory"
  | "status"
  | "lastUsed"
  | "createdAt";

// 表示値（移行行で構造化カラムがnullなら rawConditions から表示）
function registText(p: RpaPattern): string {
  if (p.registDays != null && p.registDirection) {
    return `${p.registDays}日${p.registDirection === "WITHIN" ? "以内" : "以降"}`;
  }
  return p.rawConditions?.regist_date ?? "-";
}

function areaText(p: RpaPattern): string {
  if (p.areaType === "PREFECTURES") return (p.prefectures ?? []).join("/") || "県指定";
  if (p.areaType) return AREA_TYPE_LABELS[p.areaType as keyof typeof AREA_TYPE_LABELS] ?? p.areaType;
  return p.rawConditions?.residence ?? "-";
}

function gradYearText(p: RpaPattern): string {
  if (p.gradYearFrom != null || p.gradYearTo != null) {
    return `${p.gradYearFrom ?? ""}〜${p.gradYearTo ?? ""}`;
  }
  const raw = [p.rawConditions?.grad_year_from, p.rawConditions?.grad_year_to]
    .filter(Boolean)
    .join("〜");
  return raw || "-";
}

function companyCountText(p: RpaPattern): string {
  if (p.companyCount != null) return `〜${p.companyCount}社`;
  return p.rawConditions?.company_count ?? "-";
}

function jobCategoryText(p: RpaPattern): string {
  if (p.jobCategories?.length) return p.jobCategories.join("/");
  return p.rawConditions?.job_category ?? "-";
}

export default function PatternsClient() {
  const [patterns, setPatterns] = useState<RpaPattern[]>([]);
  const [categories, setCategories] = useState<JobCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMachine, setFilterMachine] = useState<string>(""); // "" | "ALL" | "1".."6"
  const [filterSendStatus, setFilterSendStatus] = useState<string>("");
  const [filterActive, setFilterActive] = useState<string>("active"); // active | inactive | all
  const [sortKey, setSortKey] = useState<SortKey>("machine");
  const [sortAsc, setSortAsc] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  // 複製の号機選択ダイアログ（複製元と、選択中の号機 "" = 全号機）
  const [dupSource, setDupSource] = useState<RpaPattern | null>(null);
  const [dupMachine, setDupMachine] = useState<string>("");
  const dupOverlayClose = useOverlayClose(() => setDupSource(null));

  const load = useCallback(async () => {
    const [pRes, cRes] = await Promise.all([
      fetch("/api/rpa-scout/patterns?all=1"),
      fetch("/api/rpa-scout/job-categories"),
    ]);
    if (pRes.ok) setPatterns((await pRes.json()).patterns);
    if (cRes.ok) setCategories((await cRes.json()).categories);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("コピーしました"));
  };

  const openDuplicate = (p: RpaPattern) => {
    setDupSource(p);
    setDupMachine(p.targetMachineNo != null ? String(p.targetMachineNo) : "");
  };

  // 複製元の全条件を引き継ぎ、号機だけダイアログで選んだ値に差し替えて新規作成フォームを開く。
  // 名前は引き継がず生成関数で再生成、isMigrated / rawConditions は引き継がない（POST側で常にfalse/未設定）。
  const startDuplicate = () => {
    if (!dupSource) return;
    setForm({
      mode: "duplicate",
      pattern: {
        ...dupSource,
        targetMachineNo: dupMachine === "" ? null : Number(dupMachine),
      },
      sourceName: displayPatternName(dupSource.targetMachineNo, dupSource.name),
    });
    setDupSource(null);
  };

  const toggleActive = async (p: RpaPattern) => {
    const res = await fetch(`/api/rpa-scout/patterns/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (res.ok) {
      toast.success(p.isActive ? "停止しました" : "有効化しました");
      load();
    } else {
      toast.error("更新に失敗しました");
    }
  };

  const sortValue = useCallback((p: RpaPattern, key: SortKey): string | number => {
    switch (key) {
      case "machine":
        return p.targetMachineNo ?? 99;
      case "name":
        return p.name;
      case "sendStatus":
        return p.sendStatus ?? "";
      case "regist":
        return registText(p);
      case "area":
        return areaText(p);
      case "gradYear":
        return p.gradYearFrom ?? (Number(p.rawConditions?.grad_year_from) || 9999);
      case "companyCount":
        return p.companyCount ?? 99;
      case "jobCategory":
        return jobCategoryText(p);
      case "status":
        return p.isActive ? 0 : 1;
      case "lastUsed":
        return p.lastUsedAt ?? "";
      case "createdAt":
        return p.createdAt;
    }
  }, []);

  const visible = useMemo(() => {
    let rows = patterns;
    if (filterMachine === "ALL") rows = rows.filter((p) => p.targetMachineNo == null);
    else if (filterMachine) rows = rows.filter((p) => p.targetMachineNo === Number(filterMachine));
    if (filterSendStatus) rows = rows.filter((p) => p.sendStatus === filterSendStatus);
    if (filterActive === "active") rows = rows.filter((p) => p.isActive);
    else if (filterActive === "inactive") rows = rows.filter((p) => !p.isActive);
    const sorted = [...rows].sort((a, b) => {
      // 最終使用は未使用を昇順・降順のいずれでも最後尾に固定する
      if (sortKey === "lastUsed") {
        if (!a.lastUsedAt && !b.lastUsedAt) return 0;
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        const cmp = a.lastUsedAt.localeCompare(b.lastUsedAt);
        return sortAsc ? cmp : -cmp;
      }
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "ja");
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [patterns, filterMachine, filterSendStatus, filterActive, sortKey, sortAsc, sortValue]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortTh = ({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) => (
    <Th className={`whitespace-nowrap ${className}`}>
      <button
        onClick={() => onSort(k)}
        className="flex items-center gap-0.5 hover:text-[#2563EB]"
      >
        {label}
        {sortKey === k ? <span>{sortAsc ? "▲" : "▼"}</span> : null}
      </button>
    </Th>
  );

  return (
    <div>
      <Toaster position="top-center" richColors />
      <div className="mb-4 flex items-center justify-between">
        <PageTitle>検索条件パターン管理</PageTitle>
        <button
          onClick={() => setForm({ mode: "new" })}
          className="rounded-[6px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
        >
          ＋ 新規作成
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <select
          value={filterMachine}
          onChange={(e) => setFilterMachine(e.target.value)}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
        >
          <option value="">全ての号機</option>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}号機
            </option>
          ))}
          <option value="ALL">全号機用</option>
        </select>
        <select
          value={filterSendStatus}
          onChange={(e) => setFilterSendStatus(e.target.value)}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
        >
          <option value="">送信状態: 全て</option>
          <option value="UNSENT">未送信</option>
          <option value="SENT">送信済</option>
        </select>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
        >
          <option value="active">有効のみ</option>
          <option value="inactive">停止のみ</option>
          <option value="all">全て</option>
        </select>
        <span className="text-[#6B7280]">{visible.length}件</span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[14px] text-[#6B7280]">読み込み中...</div>
      ) : (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white">
          <TableWrap>
            {/* 13列あるため最小幅を確保し、足りない場合は TableWrap 側で横スクロールさせる */}
            <div className="min-w-[1450px]">
              <Table className="table-fixed">
                {/* パターン名以外を内容ぶんの固定幅にし、残りをすべてパターン名へ割り当てる */}
                <colgroup>
                  <col style={{ width: 78 }} />
                  <col />
                  <col style={{ width: 76 }} />
                  <col style={{ width: 92 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 88 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 128 }} />
                  <col style={{ width: 92 }} />
                  <col style={{ width: 176 }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortTh label="対象号機" k="machine" />
                    <SortTh label="パターン名" k="name" />
                    <SortTh label="送信状態" k="sendStatus" />
                    <SortTh label="登録日" k="regist" />
                    <SortTh label="エリア" k="area" />
                    <SortTh label="卒業年度" k="gradYear" />
                    <SortTh label="経験社数" k="companyCount" />
                    <SortTh label="職種" k="jobCategory" />
                    <SortTh label="状態" k="status" />
                    <SortTh label="最終使用" k="lastUsed" />
                    <SortTh label="作成日" k="createdAt" />
                    <Th className="sticky right-0 z-20 whitespace-nowrap bg-white shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">
                      操作
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className={p.isActive ? "" : "bg-[#F9FAFB] text-[#9CA3AF]"}>
                      <Td className="whitespace-nowrap">{machineLabel(p.targetMachineNo)}</Td>
                      <Td className="overflow-hidden">
                        <div className="flex items-center gap-1">
                          {/* 長い名前は1行で末尾省略。全文は title で読める */}
                          <span className="min-w-0 truncate" title={p.name}>
                            {p.name}
                          </span>
                          {p.isMigrated && (
                            <span className="shrink-0 rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-medium text-[#92400E]">
                              移行
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {p.sendStatus === "UNSENT"
                          ? "未送信"
                          : p.sendStatus === "SENT"
                            ? "送信済"
                            : "-"}
                      </Td>
                      <Td className="overflow-hidden whitespace-nowrap">{registText(p)}</Td>
                      <Td className="overflow-hidden">
                        <span className="block truncate" title={areaText(p)}>
                          {areaText(p)}
                        </span>
                      </Td>
                      <Td className="overflow-hidden whitespace-nowrap">{gradYearText(p)}</Td>
                      <Td className="overflow-hidden whitespace-nowrap">{companyCountText(p)}</Td>
                      <Td className="overflow-hidden">
                        <span className="block truncate" title={jobCategoryText(p)}>
                          {jobCategoryText(p)}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {p.isActive ? (
                          <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-medium text-[#166534]">
                            有効
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#E5E7EB] px-2 py-0.5 text-[11px] font-medium text-[#6B7280]">
                            停止
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {p.lastUsedAt ? (
                          <span
                            className={
                              isRecentlyUsed(p.lastUsedAt) ? "font-semibold text-red-600" : ""
                            }
                          >
                            {fmtJstShortDateTime(p.lastUsedAt)}
                            {p.lastUsedMachineNo != null && (
                              <span className="ml-1 text-[#6B7280]">
                                {p.lastUsedMachineNo}号機
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF]">-</span>
                        )}
                      </Td>
                      <Td className="overflow-hidden whitespace-nowrap">
                        {fmtUtcInstantAsJstDate(p.createdAt)}
                      </Td>
                      {/* 横スクロールしても操作ボタンが見えるよう右端に固定する */}
                      <Td
                        className={[
                          "sticky right-0 z-10 whitespace-nowrap shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]",
                          p.isActive ? "bg-white" : "bg-[#F9FAFB]",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => copy(displayPatternName(p.targetMachineNo, p.name))}
                            title="号機込みでコピー"
                            className="rounded px-1.5 py-0.5 text-[#6B7280] hover:bg-[#F3F4F6]"
                          >
                            📋
                          </button>
                          <button
                            onClick={() => setForm({ mode: "edit", pattern: p })}
                            className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => openDuplicate(p)}
                            className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            複製
                          </button>
                          <button
                            onClick={() => toggleActive(p)}
                            className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            {p.isActive ? "停止" : "復帰"}
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td
                        colSpan={12}
                        className="border-b border-[#E5E7EB] px-3 py-8 text-center text-[#9CA3AF]"
                      >
                        該当するパターンがありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </TableWrap>
        </div>
      )}

      {dupSource && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          {...dupOverlayClose}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-5 py-3 text-[15px] font-bold text-[#374151]">
              パターンを複製
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <div className="mb-1 text-[12px] font-semibold text-[#6B7280]">複製元</div>
                <div className="break-all text-[13px] text-[#111827]">
                  {displayPatternName(dupSource.targetMachineNo, dupSource.name)}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#6B7280]">
                  対象号機
                </label>
                <select
                  value={dupMachine}
                  onChange={(e) => setDupMachine(e.target.value)}
                  className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[14px]"
                >
                  <option value="">全号機</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}号機
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button
                onClick={() => setDupSource(null)}
                className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
              >
                キャンセル
              </button>
              <button
                onClick={startDuplicate}
                className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
              >
                複製して編集
              </button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <PatternFormModal
          pattern={form.mode === "new" ? null : form.pattern}
          mode={form.mode}
          sourceName={form.mode === "duplicate" ? form.sourceName : undefined}
          existingPatterns={patterns}
          categories={categories}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
    </div>
  );
}

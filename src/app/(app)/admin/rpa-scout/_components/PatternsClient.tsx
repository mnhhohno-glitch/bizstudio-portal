"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { displayPatternName, machineLabel } from "@/lib/rpa-scout/pattern-name";
import { AREA_TYPE_LABELS } from "@/lib/rpa-scout/area";
import {
  fmtUtcInstantAsJstDate,
  type JobCategoryRow,
  type RpaPattern,
} from "./types";
import PatternFormModal from "./PatternFormModal";

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
  const [formTarget, setFormTarget] = useState<RpaPattern | "new" | null>(null);

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

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <Th>
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
          onClick={() => setFormTarget("new")}
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
            <Table>
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
                  <SortTh label="作成日" k="createdAt" />
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className={p.isActive ? "" : "bg-[#F9FAFB] text-[#9CA3AF]"}>
                    <Td className="whitespace-nowrap">{machineLabel(p.targetMachineNo)}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <span className="break-all">{p.name}</span>
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
                    <Td className="whitespace-nowrap">{registText(p)}</Td>
                    <Td className="max-w-[160px] truncate" >{areaText(p)}</Td>
                    <Td className="whitespace-nowrap">{gradYearText(p)}</Td>
                    <Td className="whitespace-nowrap">{companyCountText(p)}</Td>
                    <Td className="max-w-[160px] truncate">{jobCategoryText(p)}</Td>
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
                    <Td className="whitespace-nowrap">{fmtUtcInstantAsJstDate(p.createdAt)}</Td>
                    <Td className="whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copy(displayPatternName(p.targetMachineNo, p.name))}
                          title="号機込みでコピー"
                          className="rounded px-1.5 py-0.5 text-[#6B7280] hover:bg-[#F3F4F6]"
                        >
                          📋
                        </button>
                        <button
                          onClick={() => setFormTarget(p)}
                          className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                        >
                          編集
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
                      colSpan={11}
                      className="border-b border-[#E5E7EB] px-3 py-8 text-center text-[#9CA3AF]"
                    >
                      該当するパターンがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      )}

      {formTarget && (
        <PatternFormModal
          pattern={formTarget === "new" ? null : formTarget}
          existingPatterns={patterns}
          categories={categories}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

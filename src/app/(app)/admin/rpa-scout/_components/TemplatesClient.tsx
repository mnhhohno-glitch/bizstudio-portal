"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import {
  TEMPLATE_EXCEL_NOTE,
  TEMPLATE_KIND_OPTIONS,
  templateKindLabel,
} from "@/lib/rpa-scout/constants";
import { fmtUtcInstantAsJstDate, type RpaTemplate } from "./types";
import TemplateFormModal from "./TemplateFormModal";
import { CopyFallbackModal, useCopyText } from "./CopyText";

type FormState =
  | { mode: "new" }
  | { mode: "edit"; template: RpaTemplate }
  | { mode: "duplicate"; template: RpaTemplate };

type SortKey = "kind" | "name" | "subject" | "status" | "updatedAt";

const KIND_ORDER: Record<string, number> = { UNSENT: 0, SENT: 1, INDIVIDUAL: 2 };

export default function TemplatesClient() {
  const [templates, setTemplates] = useState<RpaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<string>("");
  const [filterActive, setFilterActive] = useState<string>("active"); // active | inactive | all
  const [sortKey, setSortKey] = useState<SortKey>("kind");
  const [sortAsc, setSortAsc] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const { copy, fallback, closeFallback } = useCopyText();

  const load = useCallback(async () => {
    const res = await fetch("/api/rpa-scout/templates");
    if (res.ok) setTemplates((await res.json()).templates);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (t: RpaTemplate) => {
    const res = await fetch(`/api/rpa-scout/templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !t.isActive }),
    });
    if (res.ok) {
      toast.success(t.isActive ? "停止しました" : "有効化しました");
      load();
    } else {
      toast.error("更新に失敗しました");
    }
  };

  const sortValue = useCallback((t: RpaTemplate, key: SortKey): string | number => {
    switch (key) {
      case "kind":
        return t.kind ? (KIND_ORDER[t.kind] ?? 8) : 9;
      case "name":
        return t.name;
      case "subject":
        return t.subject;
      case "status":
        return t.isActive ? 0 : 1;
      case "updatedAt":
        return t.updatedAt;
    }
  }, []);

  const visible = useMemo(() => {
    let rows = templates;
    if (filterKind === "NONE") rows = rows.filter((t) => !t.kind);
    else if (filterKind) rows = rows.filter((t) => t.kind === filterKind);
    if (filterActive === "active") rows = rows.filter((t) => t.isActive);
    else if (filterActive === "inactive") rows = rows.filter((t) => !t.isActive);
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "ja");
      // 種別ソートは同種別内でテンプレ名順に安定させる
      if (cmp === 0 && sortKey === "kind") return a.name.localeCompare(b.name, "ja");
      return sortAsc ? cmp : -cmp;
    });
  }, [templates, filterKind, filterActive, sortKey, sortAsc, sortValue]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <Th className="whitespace-nowrap">
      <button onClick={() => onSort(k)} className="flex items-center gap-0.5 hover:text-[#2563EB]">
        {label}
        {sortKey === k ? <span>{sortAsc ? "▲" : "▼"}</span> : null}
      </button>
    </Th>
  );

  return (
    <div>
      <Toaster position="top-center" richColors />
      <div className="mb-2 flex items-center justify-between">
        <PageTitle>メールテンプレート管理</PageTitle>
        <button
          onClick={() => setForm({ mode: "new" })}
          className="rounded-[6px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
        >
          ＋ 新規作成
        </button>
      </div>

      <div className="mb-3 rounded-[6px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#92400E]">
        {TEMPLATE_EXCEL_NOTE}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
        >
          <option value="">種別: 全て</option>
          {TEMPLATE_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value="NONE">未設定</option>
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
            <div className="min-w-[1100px]">
              <Table className="table-fixed">
                {/* 件名に残り幅を割り当て、他は内容ぶんの固定幅 */}
                <colgroup>
                  <col style={{ width: 96 }} />
                  <col style={{ width: 300 }} />
                  <col />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 250 }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortTh label="種別" k="kind" />
                    <SortTh label="テンプレ名" k="name" />
                    <SortTh label="件名" k="subject" />
                    <SortTh label="状態" k="status" />
                    <SortTh label="更新日" k="updatedAt" />
                    <Th className="sticky right-0 z-20 whitespace-nowrap bg-white shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">
                      操作
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr key={t.id} className={t.isActive ? "" : "bg-[#F9FAFB] text-[#9CA3AF]"}>
                      <Td className="whitespace-nowrap">{templateKindLabel(t.kind)}</Td>
                      <Td className="overflow-hidden">
                        <span className="block truncate" title={t.name}>
                          {t.name}
                        </span>
                      </Td>
                      {/* 件名は長いので1行省略＋マウスオーバーで全文（パターン一覧と同じ方式） */}
                      <Td className="overflow-hidden">
                        <span className="block truncate" title={t.subject}>
                          {t.subject}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {t.isActive ? (
                          <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-medium text-[#166534]">
                            有効
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#E5E7EB] px-2 py-0.5 text-[11px] font-medium text-[#6B7280]">
                            停止
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{fmtUtcInstantAsJstDate(t.updatedAt)}</Td>
                      <Td
                        className={[
                          "sticky right-0 z-10 whitespace-nowrap shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]",
                          t.isActive ? "bg-white" : "bg-[#F9FAFB]",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => copy(t.subject, "件名")}
                            className="rounded border border-[#D1D5DB] px-1.5 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            件名📋
                          </button>
                          <button
                            onClick={() => copy(t.body ?? "", "本文")}
                            className="rounded border border-[#D1D5DB] px-1.5 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            本文📋
                          </button>
                          <button
                            onClick={() => setForm({ mode: "edit", template: t })}
                            className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => setForm({ mode: "duplicate", template: t })}
                            className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            複製
                          </button>
                          <button
                            onClick={() => toggleActive(t)}
                            className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            {t.isActive ? "停止" : "復帰"}
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="border-b border-[#E5E7EB] px-3 py-8 text-center text-[#9CA3AF]"
                      >
                        該当するテンプレートがありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </TableWrap>
        </div>
      )}

      {form && (
        <TemplateFormModal
          template={form.mode === "new" ? null : form.template}
          mode={form.mode}
          existingTemplates={templates}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}

      {fallback && (
        <CopyFallbackModal title={fallback.title} text={fallback.text} onClose={closeFallback} />
      )}
    </div>
  );
}

"use client";

// T-207: 配信テンプレート管理（画面本体）。
// 一覧・新規作成・編集・削除・CSV 取り込み。テンプレート番号（T-001）は自動採番で人は編集できない。
// 配信条件で使われているテンプレートは削除できない（サーバー側でも 409 で弾く）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";
import {
  MERGE_TAGS,
  TEMPLATE_KINDS,
  TEMPLATE_SUBJECT_LIMIT,
  templateKindLabel,
} from "@/lib/scout-conditions/constants";
import type { TemplateDto, TemplatesResponse } from "@/lib/scout-conditions/types";
import { HighlightedText } from "../../conditions/_components/TemplatePreview";
import TemplateModal, { type TemplateModalMode } from "./TemplateModal";
import ImportModal from "./ImportModal";

const KIND_BADGE: Record<string, string> = {
  UNSENT: "bg-[#E0E7FF] text-[#3730A3]",
  SENT: "bg-[#FEF3C7] text-[#92400E]",
  INDIVIDUAL: "bg-[#F3E8FF] text-[#7E22CE]",
};

export default function TemplatesClient() {
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<string>("ALL");
  const [modal, setModal] = useState<TemplateModalMode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scout/templates");
      if (!res.ok) {
        toast.error("テンプレートの取得に失敗しました");
        return;
      }
      setData((await res.json()) as TemplatesResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const all = data?.templates ?? [];
    return kindFilter === "ALL" ? all : all.filter((t) => t.kind === kindFilter);
  }, [data, kindFilter]);

  const countByKind = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of data?.templates ?? []) m[t.kind] = (m[t.kind] ?? 0) + 1;
    return m;
  }, [data]);

  const usage = (t: TemplateDto) => data?.usageById[t.id] ?? 0;

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async (t: TemplateDto) => {
    const used = usage(t);
    if (used > 0) {
      toast.error(`配信条件${used}件で使われているため削除できません`);
      return;
    }
    if (!window.confirm(`${t.templateNo ?? ""}「${t.name}」を削除します。よろしいですか？\n（番号は再利用されません）`)) return;
    const res = await fetch(`/api/scout/templates/${t.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(json?.error ?? "削除に失敗しました");
      return;
    }
    toast.success("削除しました");
    void load();
  };

  return (
    <div className="p-6">
      <Toaster position="top-center" richColors />
      <ScoutNav />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111827]">配信テンプレート</h1>
          <p className="mt-0.5 text-[12px] text-[#6B7280]">
            スカウトの件名・本文。配信条件ごとにここから1本を選びます。番号（T-001）は自動採番で、削除しても後続は振り直しません。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            CSV 取り込み
          </button>
          <button
            type="button"
            onClick={() => setModal({ kind: "new" })}
            className="rounded-[6px] bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
          >
            テンプレートを追加
          </button>
        </div>
      </div>

      {/* 差し込みの案内は一覧にも出す（どのテンプレートでも4種類すべて使える） */}
      <div className="mb-3 flex flex-wrap items-center gap-1 rounded-[6px] border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[12px] text-[#1E40AF]">
        <span className="font-semibold">差し込み項目：</span>
        {MERGE_TAGS.map((t) => (
          <span key={t.tag} className={`rounded px-1 font-medium ${t.className}`}>
            {t.tag}
          </span>
        ))}
        <span className="ml-1">
          件名・本文のどちらにも書けます。配信時に RPA が1人ごとの値へ置き換えます。件名は差し込み後に
          {TEMPLATE_SUBJECT_LIMIT}文字を超えるとマイナビの定型文で送信されます。
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {[{ value: "ALL", label: "すべて" }, ...TEMPLATE_KINDS].map((k) => {
          const active = kindFilter === k.value;
          const n = k.value === "ALL" ? (data?.templates.length ?? 0) : (countByKind[k.value] ?? 0);
          return (
            <button
              key={k.value}
              type="button"
              onClick={() => setKindFilter(k.value)}
              className={[
                "rounded-[6px] border px-3 py-1 text-[12px]",
                active ? "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#1D4ED8]" : "border-[#D1D5DB] text-[#6B7280] hover:bg-[#F9FAFB]",
              ].join(" ")}
            >
              {k.label}（{n}）
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-12 text-center text-[13px] text-[#6B7280]">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[#D1D5DB] py-12 text-center text-[13px] text-[#9CA3AF]">
          テンプレートがありません。「CSV 取り込み」か「テンプレートを追加」から登録してください。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-[#E5E7EB]">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-[#F3F4F6] text-[11px] text-[#374151]">
              <tr>
                <th className="w-0 whitespace-nowrap px-2 py-2 text-left">番号</th>
                <th className="w-0 whitespace-nowrap px-2 py-2 text-left">種別</th>
                <th className="w-full px-2 py-2 text-left">テンプレート名 / 件名</th>
                <th className="w-0 whitespace-nowrap px-2 py-2 text-right">件名</th>
                <th className="w-0 whitespace-nowrap px-2 py-2 text-right">使用中</th>
                <th className="w-0 whitespace-nowrap px-2 py-2 text-left">状態</th>
                <th className="w-0 whitespace-nowrap px-2 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const len = [...t.subject].length;
                const over = len > TEMPLATE_SUBJECT_LIMIT;
                const used = usage(t);
                const open = expanded.has(t.id);
                return (
                  <tr key={t.id} className="border-t border-[#E5E7EB] align-top hover:bg-[#FAFAFA]">
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-[12px] font-semibold text-[#111827]">
                      {t.templateNo ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_BADGE[t.kind] ?? "bg-[#F3F4F6] text-[#374151]"}`}>
                        {templateKindLabel(t.kind)}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => toggle(t.id)} className="text-left">
                        <div className="font-medium text-[#111827]">{t.name}</div>
                        <div className="mt-0.5 text-[12px] text-[#6B7280]">
                          <HighlightedText text={t.subject} />
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#9CA3AF]">{open ? "▲ 本文を閉じる" : "▼ 本文を見る"}</div>
                      </button>
                      {open && (
                        <div className="mt-2 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-[6px] border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2 text-[12px] leading-relaxed text-[#374151]">
                          <HighlightedText text={t.body} />
                        </div>
                      )}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-2 text-right text-[12px] ${over ? "font-semibold text-[#B91C1C]" : "text-[#6B7280]"}`}>
                      {len}字
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-[12px] text-[#6B7280]">
                      {used > 0 ? `${used}件` : "-"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-[12px]">
                      {t.isActive ? (
                        <span className="text-[#6B7280]">有効</span>
                      ) : (
                        <span className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] text-[#6B7280]">停止</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "edit", template: t })}
                          className="block w-[72px] rounded-[6px] border border-[#D1D5DB] px-2 py-1 text-center text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(t)}
                          disabled={used > 0}
                          title={used > 0 ? `配信条件${used}件で使われているため削除できません` : undefined}
                          className="block w-[72px] rounded-[6px] border border-[#FCA5A5] px-2 py-1 text-center text-[12px] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:border-[#E5E7EB] disabled:text-[#9CA3AF] disabled:hover:bg-transparent"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <TemplateModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void load();
          }}
        />
      )}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImported={() => void load()} />}
    </div>
  );
}

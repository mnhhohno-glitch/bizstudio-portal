"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TEMPLATE_KIND_OTHER_LABEL,
  TEMPLATE_KIND_VALUES,
  templateKindLabel,
  templateKindOrder,
} from "@/lib/rpa-scout/constants";
import type { RpaTemplate } from "./types";

// 件名テンプレートの選択。種別（未送信用／送信済用／個別配信用）でグループ分けし、
// 選択中パターンの送信状態に合う種別を先頭に出す。選択肢は絞り込まない。
// ネイティブ <select> では種別の色帯や行内バッジ（「現在」）が出せないため独自ドロップダウン。
export default function SubjectTemplateSelect({
  templates,
  value,
  onChange,
  sendStatus,
  currentTemplateId,
}: {
  templates: RpaTemplate[];
  value: string;
  onChange: (id: string) => void;
  sendStatus: string | null | undefined; // 選択中パターンの送信状態。未選択/移行パターンは null
  currentTemplateId?: string | null; // その号機に現在設定されている件名テンプレ。不明ならundefined/null
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const active = templates.filter((t) => t.isActive);
    const byName = (a: RpaTemplate, b: RpaTemplate) => a.name.localeCompare(b.name, "ja");
    const result: { key: string; label: string; items: RpaTemplate[] }[] = [];
    for (const kind of templateKindOrder(sendStatus)) {
      const items = active.filter((t) => t.kind === kind).sort(byName);
      if (items.length > 0) result.push({ key: kind, label: templateKindLabel(kind), items });
    }
    // kind が null／未知の値のものは最後に「その他」でまとめる
    const others = active
      .filter((t) => !t.kind || !TEMPLATE_KIND_VALUES.includes(t.kind))
      .sort(byName);
    if (others.length > 0) {
      result.push({ key: "__other__", label: TEMPLATE_KIND_OTHER_LABEL, items: others });
    }
    return result;
  }, [templates, sendStatus]);

  // キーボード操作用に、グループをまたいだ通し番号を振る
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const indexOfId = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [flat]);

  const selected = templates.find((t) => t.id === value) ?? null;
  const isCurrent = (id: string) => !!currentTemplateId && id === currentTemplateId;

  const openList = useCallback(() => {
    setActiveIndex(value && indexOfId.has(value) ? indexOfId.get(value)! : 0);
    setOpen(true);
  }, [value, indexOfId]);

  const commit = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // アクティブ行をリスト内にスクロールで追従させる
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (open) {
        e.stopPropagation(); // モーダル自体は閉じない
        setOpen(false);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (flat.length === 0) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + d + flat.length) % flat.length);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const t = flat[activeIndex];
      if (t) commit(t.id);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        className="flex w-full items-center justify-between gap-2 rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1.5 text-left text-[14px]"
      >
        <span className={selected ? "truncate text-[#374151]" : "truncate text-[#9CA3AF]"}>
          {selected ? selected.name : "選択してください"}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected && isCurrent(selected.id) && <CurrentBadge />}
          <span className="text-[11px] text-[#9CA3AF]">▼</span>
        </span>
      </button>

      {open && (
        <div
          ref={listRef}
          className="absolute z-30 mt-1 max-h-[280px] w-full overflow-y-auto rounded-[6px] border border-[#D1D5DB] bg-white shadow-lg"
        >
          {flat.length === 0 ? (
            <div className="px-2 py-2 text-[13px] text-[#9CA3AF]">
              選択できるテンプレートがありません
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <div className="border-y border-[#BFDBFE] bg-[#EFF6FF] px-2 py-1 text-[11px] font-bold text-[#1E3A8A]">
                  {g.label}
                </div>
                {g.items.map((t) => {
                  const idx = indexOfId.get(t.id)!;
                  const active = idx === activeIndex;
                  const cur = isCurrent(t.id);
                  const bg = active
                    ? cur
                      ? "bg-[#FDE68A]"
                      : "bg-[#F3F4F6]"
                    : cur
                      ? "bg-[#FEF9C3]"
                      : "bg-white";
                  return (
                    <button
                      type="button"
                      key={t.id}
                      data-idx={idx}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => commit(t.id)}
                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] ${bg} ${
                        t.id === value ? "font-semibold text-[#1D4ED8]" : "text-[#374151]"
                      }`}
                    >
                      <span className="min-w-0 flex-1 break-all">{t.name}</span>
                      {cur && <CurrentBadge />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-1 text-[11px] text-[#6B7280]">
        パターンの送信状態に合う種別を上に表示しています（他の種別も下から選べます）
      </div>

      {/* 選択中テンプレの中身確認（表示専用。編集はテンプレート管理タブ） */}
      {selected && (
        <div className="mt-2 rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#6B7280]">件名</span>
            <span className="shrink-0 rounded bg-[#E5E7EB] px-1.5 py-0.5 text-[10px] text-[#6B7280]">
              表示専用（編集不可）
            </span>
          </div>
          <div className="mb-2 break-all text-[13px] text-[#374151]">{selected.subject}</div>
          <div className="mb-1 text-[11px] font-semibold text-[#6B7280]">本文</div>
          <div className="h-[200px] overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] border border-[#E5E7EB] bg-white p-2 text-[12px] leading-relaxed text-[#374151]">
            {selected.body || "（本文が未登録です）"}
          </div>
          <div className="mt-1 text-[11px] text-[#6B7280]">
            内容の修正はテンプレート管理から行ってください
          </div>
        </div>
      )}
    </div>
  );
}

function CurrentBadge() {
  return (
    <span className="shrink-0 rounded-full bg-[#FDE68A] px-1.5 py-0.5 text-[10px] font-bold text-[#92400E]">
      現在
    </span>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 独自ドロップダウン（件名テンプレ選択／パターン選択で共用）の開閉・キーボード操作・
// 外側クリックで閉じる挙動。行の見た目は呼び出し側が描画する（各行に data-idx で通し番号を振ること）。
// ネイティブ <select> では種別の色帯・行内バッジ・絞り込みチップが表現できないため独自実装。
export function useDropdownList({
  ids,
  value,
  onChange,
}: {
  ids: string[]; // 表示順に並んだ選択肢のid（data-idx はこの並びの添字）
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const openList = useCallback(() => {
    const i = ids.indexOf(value);
    setActiveIndex(i >= 0 ? i : 0);
    setOpen(true);
  }, [ids, value]);

  const commit = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange]
  );

  const toggle = useCallback(() => {
    if (open) setOpen(false);
    else openList();
  }, [open, openList]);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 絞り込み・並び替えで行数が変わったとき、アクティブ行を範囲内に収める
  const count = ids.length;
  useEffect(() => {
    setActiveIndex((i) => (count === 0 ? -1 : Math.min(Math.max(i, 0), count - 1)));
  }, [count]);

  // アクティブ行をリスト内にスクロールで追従させる
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 絞り込みチップ等（data-dropdown-controls 配下）での Enter/Space はチップ側に任せる
    const inControls =
      e.target instanceof Element && e.target.closest("[data-dropdown-controls]") != null;

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
      if (count === 0) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + d + count) % count);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (inControls) return;
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const id = ids[activeIndex];
      if (id) commit(id);
    }
  };

  return { open, setOpen, activeIndex, setActiveIndex, rootRef, listRef, toggle, commit, onKeyDown };
}

// グループ見出しの薄い青の帯
export function DropdownBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-y border-[#BFDBFE] bg-[#EFF6FF] px-2 py-1 text-[11px] font-bold text-[#1E3A8A]">
      {children}
    </div>
  );
}

// 絞り込み・並び替えのチップ1行
export function DropdownChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[52px] shrink-0 text-[10px] font-semibold text-[#6B7280]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              value === o.value
                ? "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#2563EB]"
                : "border-[#D1D5DB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

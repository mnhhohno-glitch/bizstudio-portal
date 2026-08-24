"use client";

/**
 * 一覧フィルタ共通レイアウト（T-105）。
 *
 * 3画面（求職者管理 / 面談管理 / エントリー管理）でフィルタUIを揃えるための
 * 表示専用プリミティブ。state・ハンドラは各画面が保持し、ここは見た目のみ。
 *
 * 構成: 上段 = 3列（担当者 / 期間 / 検索）、下段 = 全幅（区分）。
 * 各フィールドはラベルを入力の上に置く。日付は「開始 〜 終了」を1枠に。
 * デザインは既存トークン（border-gray-300 / rounded-md / text-sm / focus ring #2563EB）。
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export const FILTER_INPUT_CLS =
  "border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

/** フィルタ全体の枠（上段3列 + 下段全幅 を縦に並べる） */
export function FilterShell({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 space-y-3">
      {children}
    </div>
  );
}

/**
 * 上段（担当者 / 期間 / 検索）。グループは自然幅（shrink-0）で横並びし、
 * 幅が足りないときだけグループ単位で折り返す。各グループのフィールド上端は
 * `items-start` で揃える（ラベル高さ・入力高さは共通プリミティブで統一）。
 */
export function FilterTopRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-6 gap-y-3">{children}</div>;
}

/**
 * グループ（薄い見出しで区切り、フィールド群を横並び）。
 * 既定は自然幅（`shrink-0`）でフィールドを1行に保つ（期間の日付3つも横1行）。
 * `fullWidth` 指定時は下段の全幅グループ（区分 / 表示）として折り返し許容。
 */
export function FilterGroup({ label, children, fullWidth = false }: { label: string; children: ReactNode; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? "w-full" : "shrink-0"}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold leading-4 tracking-wide text-gray-400">{label}</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <div className={`flex items-end gap-2 ${fullWidth ? "flex-wrap" : ""}`}>{children}</div>
    </div>
  );
}

/** 1フィールド（ラベルを入力の上に置いて整列。ラベル高さは leading-4 で統一） */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[11px] leading-4 text-gray-500 whitespace-nowrap">{label}</label>
      {children}
    </div>
  );
}

/** 日付範囲（開始 〜 終了 を1枠に。比較は各画面が Asia/Tokyo 基準で実施） */
export function DateRangeField({
  label, from, to, onFrom, onTo, width = "w-[130px]",
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  width?: string;
}) {
  return (
    <FilterField label={label}>
      <div className="flex items-center gap-1">
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className={`${width} ${FILTER_INPUT_CLS}`} />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className={`${width} ${FILTER_INPUT_CLS}`} />
      </div>
    </FilterField>
  );
}

/** 複数選択フィールドの選択肢（T-181） */
export type FilterMultiOption = { value: string; label: string };

/**
 * チェックボックス式の複数選択フィールド（T-181）。
 *
 * `<select>` の代わりにボタン＋開閉パネルを出し、複数値を同時に選べるようにする。
 * state（selected）は呼び出し側が持ち、ここは表示と開閉のみ担当する（他プリミティブと同じ方針）。
 *
 * - selected が空配列 ＝ 絞り込みなし（ボタン表示は `allLabel`）
 * - `specialOption` は本体リストの上に区切り線付きで別置きする（例: 「未設定」）
 * - 「全選択」は **本体リストのみ** を選ぶ（specialOption は含めない）。
 *   これにより「全選択 ＝ 値が設定されている行のみ」という絞り込みが成立する。
 * - 「全解除」は空配列に戻す（＝全件表示）
 *
 * 高さは他フィールドと揃えるため FILTER_INPUT_CLS をそのまま使う（高さのハードコードはしない）。
 */
export function FilterMultiSelectField({
  label,
  options,
  specialOption,
  selected,
  onChange,
  width = "w-40",
  panelWidth = "w-56",
  allLabel = "ALL",
  allSelectedLabel,
  moreUnit = "件",
}: {
  label: string;
  options: FilterMultiOption[];
  specialOption?: FilterMultiOption;
  selected: string[];
  onChange: (next: string[]) => void;
  width?: string;
  panelWidth?: string;
  allLabel?: string;
  /** 本体リストを全選択（specialOption 非選択）のときのボタン表示。未指定なら通常の「◯◯ 他N件」表示 */
  allSelectedLabel?: string;
  /** 「他N件」の単位（人を数えるフィールドなら "名"） */
  moreUnit?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // パネル外クリック / Esc で閉じる（選択内容は保持する）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  // ボタン表示は「選択肢の並び順」で決める（チェックした順に左右されない）
  const ordered = [...options, ...(specialOption ? [specialOption] : [])].filter((o) =>
    selected.includes(o.value)
  );
  const isAllMainSelected =
    options.length > 1 &&
    selected.length === options.length &&
    options.every((o) => selected.includes(o.value));

  let buttonLabel: string;
  if (ordered.length === 0) buttonLabel = allLabel;
  else if (allSelectedLabel && isAllMainSelected) buttonLabel = allSelectedLabel;
  else if (ordered.length === 1) buttonLabel = ordered[0].label;
  else buttonLabel = `${ordered[0].label} 他${ordered.length - 1}${moreUnit}`;

  const renderItem = (o: FilterMultiOption) => (
    <label
      key={o.value}
      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      <input
        type="checkbox"
        checked={selected.includes(o.value)}
        onChange={() => toggle(o.value)}
        className="h-3.5 w-3.5 accent-[#2563EB]"
      />
      <span className="truncate">{o.label}</span>
    </label>
  );

  return (
    <FilterField label={label}>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`${width} ${FILTER_INPUT_CLS} flex items-center justify-between gap-1 text-left`}
        >
          <span className="truncate">{buttonLabel}</span>
          <span className="shrink-0 text-[10px] text-gray-400">▼</span>
        </button>
        {open && (
          <div
            className={`absolute left-0 top-full z-30 mt-1 ${panelWidth} rounded-md border border-gray-300 bg-white shadow-lg`}
          >
            <div className="flex gap-2 p-2">
              <button
                type="button"
                onClick={() => onChange(options.map((o) => o.value))}
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-[#2563EB] hover:bg-gray-50"
              >
                全選択
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                全解除
              </button>
            </div>
            {specialOption && (
              <>
                <div className="h-px bg-gray-200" />
                <div className="py-1">{renderItem(specialOption)}</div>
              </>
            )}
            <div className="h-px bg-gray-200" />
            <div className="max-h-72 overflow-y-auto py-1">{options.map(renderItem)}</div>
          </div>
        )}
      </div>
    </FilterField>
  );
}

/** クリアボタン（フィールドと同じ高さに揃うようラベル分のスペーサーを持つ） */
export function FilterClearButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] leading-4 text-transparent select-none" aria-hidden>_</span>
      <button
        type="button"
        onClick={onClick}
        className="border border-gray-300 rounded-md bg-white px-3 py-1.5 text-sm text-[#2563EB] hover:bg-gray-50"
      >
        クリア
      </button>
    </div>
  );
}

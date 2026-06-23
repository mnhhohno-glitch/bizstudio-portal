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

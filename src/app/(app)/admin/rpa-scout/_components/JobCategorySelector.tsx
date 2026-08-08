"use client";

import { useMemo, useState } from "react";
import type { JobCategoryRow } from "./types";

// 職種選択（大分類→中分類→小分類の3階層絞り込み・小分類最大3件）
export default function JobCategorySelector({
  categories,
  selected,
  onChange,
}: {
  categories: JobCategoryRow[];
  selected: string[];
  onChange: (smalls: string[]) => void;
}) {
  const [large, setLarge] = useState("");
  const [middle, setMiddle] = useState("");

  const larges = useMemo(
    () => Array.from(new Set(categories.map((c) => c.large))),
    [categories]
  );
  const middles = useMemo(
    () =>
      Array.from(
        new Set(categories.filter((c) => c.large === large).map((c) => c.middle))
      ),
    [categories, large]
  );
  const smalls = useMemo(
    () =>
      categories
        .filter((c) => c.large === large && c.middle === middle)
        .map((c) => c.small),
    [categories, large, middle]
  );

  const toggle = (small: string) => {
    if (selected.includes(small)) {
      onChange(selected.filter((s) => s !== small));
    } else {
      if (selected.length >= 3) return; // 最大3件
      onChange([...selected, small]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={large}
          onChange={(e) => {
            setLarge(e.target.value);
            setMiddle("");
          }}
          className="flex-1 rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px]"
        >
          <option value="">大分類を選択</option>
          {larges.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={middle}
          onChange={(e) => setMiddle(e.target.value)}
          disabled={!large}
          className="flex-1 rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] disabled:bg-[#F9FAFB]"
        >
          <option value="">中分類を選択</option>
          {middles.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {middle && (
        <div className="max-h-40 overflow-y-auto rounded-[6px] border border-[#E5E7EB] p-2">
          {smalls.map((s) => {
            const checked = selected.includes(s);
            const disabled = !checked && selected.length >= 3;
            return (
              <label
                key={s}
                className={[
                  "flex items-center gap-1.5 py-0.5 text-[13px]",
                  disabled ? "text-[#9CA3AF]" : "text-[#374151]",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(s)}
                />
                {s}
              </label>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1 rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[12px] text-[#2563EB]"
            >
              {s}
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== s))}
                className="text-[#2563EB] hover:text-[#1D4ED8]"
              >
                ×
              </button>
            </span>
          ))}
          <span className="text-[11px] text-[#9CA3AF]">（最大3件）</span>
        </div>
      )}
    </div>
  );
}

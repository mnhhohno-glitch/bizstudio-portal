"use client";

import { useState, useEffect, useMemo, useRef } from "react";

export interface FlatItem {
  large: string;
  medium: string;
  small: string;
}

interface Props {
  apiUrl: string;
  selected: FlatItem[];
  onChange: (items: FlatItem[]) => void;
  maxSelect: number;
  columnLabels: [string, string, string];
  searchPlaceholder?: string;
  disabled?: boolean;
}

function itemKey(item: FlatItem) {
  return `${item.large}\0${item.medium}\0${item.small}`;
}

function itemLabel(item: FlatItem, labels: [string, string, string]) {
  return [item[labels[0] === labels[0] ? "large" : "large"], item.medium, item.small]
    .filter(Boolean)
    .join(" / ");
}

export default function SearchableMultiSelect({
  apiUrl,
  selected,
  onChange,
  maxSelect,
  columnLabels,
  searchPlaceholder = "検索...",
  disabled,
}: Props) {
  const [allItems, setAllItems] = useState<FlatItem[]>([]);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => setAllItems(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [apiUrl]);

  const selectedKeys = useMemo(
    () => new Set(selected.map(itemKey)),
    [selected]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.trim().toLowerCase();
    return allItems.filter(
      (item) =>
        item.large.toLowerCase().includes(q) ||
        item.medium.toLowerCase().includes(q) ||
        item.small.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  const toggle = (item: FlatItem) => {
    const key = itemKey(item);
    if (selectedKeys.has(key)) {
      onChange(selected.filter((s) => itemKey(s) !== key));
    } else {
      if (selected.length >= maxSelect) return;
      onChange([...selected, item]);
    }
  };

  const remove = (item: FlatItem) => {
    onChange(selected.filter((s) => itemKey(s) !== itemKey(item)));
  };

  const atLimit = selected.length >= maxSelect;

  return (
    <div style={{ fontSize: 13 }}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((item) => (
            <span
              key={itemKey(item)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1"
              style={{
                background: "var(--im-bg2, #F3F4F6)",
                color: "var(--im-fg, #374151)",
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {item.large} / {item.medium} / {item.small}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="ml-0.5 hover:text-red-500 transition-colors"
                  style={{ fontSize: 14, lineHeight: 1, color: "var(--im-fg3, #9CA3AF)" }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="relative mb-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
          className="w-full rounded-[6px] border px-3 py-1.5 pl-8 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
          style={{
            borderColor: "var(--im-bdr, #D1D5DB)",
            fontSize: 13,
            background: disabled ? "var(--im-bg2, #F3F4F6)" : "var(--im-bg, #fff)",
          }}
        />
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: "var(--im-fg3, #9CA3AF)" }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>

      {atLimit && (
        <div
          className="mb-1.5 rounded px-2 py-1"
          style={{ fontSize: 11, color: "#B45309", background: "#FEF3C7" }}
        >
          上限（{maxSelect}件）に達しています。追加するには既存の選択を解除してください。
        </div>
      )}

      <div
        ref={listRef}
        className="border rounded-[6px] overflow-y-auto"
        style={{
          maxHeight: 220,
          borderColor: "var(--im-bdr, #D1D5DB)",
          background: "var(--im-bg, #fff)",
        }}
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center" style={{ color: "var(--im-fg3, #9CA3AF)", fontSize: 12 }}>
            {allItems.length === 0 ? "読み込み中..." : "該当なし"}
          </div>
        ) : (
          filtered.map((item) => {
            const key = itemKey(item);
            const checked = selectedKeys.has(key);
            const isDisabled = disabled || (!checked && atLimit);
            return (
              <label
                key={key}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                style={{
                  borderBottom: "0.5px solid var(--im-bdr2, #F3F4F6)",
                  opacity: isDisabled && !checked ? 0.45 : 1,
                  cursor: isDisabled && !checked ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isDisabled && !checked}
                  onChange={() => toggle(item)}
                  className="accent-[#2563EB] flex-shrink-0"
                  style={{ width: 15, height: 15 }}
                />
                <span style={{ fontSize: 12, color: "var(--im-fg, #374151)", lineHeight: 1.5 }}>
                  <span style={{ color: "var(--im-fg2, #6B7280)" }}>{item.large}</span>
                  {" / "}
                  <span>{item.medium}</span>
                  {" / "}
                  <span style={{ fontWeight: 500 }}>{item.small}</span>
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

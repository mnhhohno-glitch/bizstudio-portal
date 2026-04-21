"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

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
  modalTitle?: string;
  disabled?: boolean;
}

function itemKey(item: FlatItem) {
  return `${item.large}\0${item.medium}\0${item.small}`;
}

export default function SearchableMultiSelect({
  apiUrl,
  selected,
  onChange,
  maxSelect,
  searchPlaceholder = "検索...",
  modalTitle = "検索",
  disabled,
}: Props) {
  const [allItems, setAllItems] = useState<FlatItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [tempSelected, setTempSelected] = useState<FlatItem[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => setAllItems(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [apiUrl]);

  const openModal = useCallback(() => {
    setTempSelected([...selected]);
    setQuery("");
    setIsOpen(true);
  }, [selected]);

  const confirm = useCallback(() => {
    onChange(tempSelected);
    setIsOpen(false);
  }, [tempSelected, onChange]);

  const cancel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const removeTag = useCallback(
    (item: FlatItem) => {
      onChange(selected.filter((s) => itemKey(s) !== itemKey(item)));
    },
    [selected, onChange]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, cancel]);

  const tempKeys = useMemo(() => new Set(tempSelected.map(itemKey)), [tempSelected]);

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

  const toggleItem = (item: FlatItem) => {
    const key = itemKey(item);
    if (tempKeys.has(key)) {
      setTempSelected((prev) => prev.filter((s) => itemKey(s) !== key));
    } else if (tempSelected.length < maxSelect) {
      setTempSelected((prev) => [...prev, item]);
    }
  };

  const atLimit = tempSelected.length >= maxSelect;

  return (
    <>
      {/* Collapsed state */}
      <div
        className="flex flex-wrap items-center gap-1.5 min-h-[36px] rounded-[6px] border px-2 py-1.5"
        style={{ borderColor: "var(--im-bdr, #D1D5DB)", background: "var(--im-bg, #fff)" }}
      >
        <button
          type="button"
          onClick={openModal}
          disabled={disabled}
          className="flex-shrink-0 rounded p-1 transition-colors hover:bg-[#F3F4F6]"
          style={{ color: "var(--im-fg2, #6B7280)" }}
          title={modalTitle}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
        {selected.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--im-fg3, #9CA3AF)" }}>未選択</span>
        )}
        {selected.map((item) => (
          <span
            key={itemKey(item)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5"
            style={{ background: "var(--im-bg2, #F3F4F6)", color: "var(--im-fg, #374151)", fontSize: 12, lineHeight: 1.4 }}
          >
            {item.large} &gt; {item.medium} &gt; {item.small}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(item)}
                className="ml-0.5 hover:text-red-500 transition-colors"
                style={{ fontSize: 14, lineHeight: 1, color: "var(--im-fg3, #9CA3AF)" }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
        >
          <div
            className="flex flex-col rounded-lg shadow-xl w-full max-w-2xl mx-4"
            style={{ background: "var(--im-bg, #fff)", maxHeight: "80vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--im-bdr, #D1D5DB)" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--im-fg, #374151)" }}>{modalTitle}</span>
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 12, color: "var(--im-fg2, #6B7280)" }}>最大{maxSelect}つまで選択</span>
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded p-1 hover:bg-[#F3F4F6] transition-colors"
                  style={{ color: "var(--im-fg3, #9CA3AF)", fontSize: 18, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--im-bdr2, #F3F4F6)" }}>
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ color: "var(--im-fg3, #9CA3AF)" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  autoFocus
                  className="w-full rounded-[6px] border px-3 py-2 pl-9 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                  style={{ borderColor: "var(--im-bdr, #D1D5DB)", fontSize: 13 }}
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto" style={{ minHeight: 120 }}>
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center" style={{ color: "var(--im-fg3, #9CA3AF)", fontSize: 13 }}>
                  {allItems.length === 0 ? "読み込み中..." : "該当なし"}
                </div>
              ) : (
                filtered.map((item) => {
                  const key = itemKey(item);
                  const checked = tempKeys.has(key);
                  const isDisabled = !checked && atLimit;
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                      style={{
                        borderBottom: "0.5px solid var(--im-bdr2, #F3F4F6)",
                        opacity: isDisabled ? 0.4 : 1,
                        cursor: isDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isDisabled}
                        onChange={() => toggleItem(item)}
                        className="accent-[#2563EB] flex-shrink-0"
                        style={{ width: 16, height: 16 }}
                      />
                      <span style={{ fontSize: 13, color: "var(--im-fg, #374151)", lineHeight: 1.5 }}>
                        <span style={{ color: "var(--im-fg2, #6B7280)" }}>{item.large}</span>
                        {" > "}
                        <span>{item.medium}</span>
                        {" > "}
                        <span style={{ fontWeight: 500 }}>{item.small}</span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: "1px solid var(--im-bdr, #D1D5DB)" }}
            >
              <span style={{ fontSize: 13, color: "var(--im-fg2, #6B7280)" }}>
                {tempSelected.length} / {maxSelect} 選択中
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-[6px] border px-4 py-1.5 transition-colors hover:bg-[#F9FAFB]"
                  style={{ fontSize: 13, borderColor: "var(--im-bdr, #D1D5DB)", color: "var(--im-fg, #374151)" }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  className="rounded-[6px] px-4 py-1.5 transition-colors"
                  style={{ fontSize: 13, background: "#2563EB", color: "#fff" }}
                >
                  選択を確定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

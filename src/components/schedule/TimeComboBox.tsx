"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function isValidTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export default function TimeComboBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // scroll to nearest option when dropdown opens
  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = TIME_OPTIONS.findIndex((t) => t >= value);
    const target = idx >= 0 ? idx : 0;
    const item = listRef.current.children[target] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ block: "center" });
    }
  }, [open, value]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const commit = useCallback(
    (v: string) => {
      if (isValidTime(v)) {
        onChange(v);
        setDraft(v);
      } else {
        setDraft(value);
      }
    },
    [onChange, value],
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={draft}
        onFocus={() => setOpen(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(draft);
            setOpen(false);
          }
        }}
        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] focus:border-[#2563EB] focus:outline-none"
      />
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg"
        >
          {TIME_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur
                onChange(t);
                setDraft(t);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#EFF6FF] ${
                t === value ? "bg-[#EFF6FF] font-medium text-[#2563EB]" : "text-[#374151]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// T-096 追補3 Task 4: 詳細画面から他社員へ切り替える検索ボックス（FileMaker の左リスト相当）。
// クライアント側フィルタのみ。選択で /admin/users/[id] へ router.push。

export type EmployeeListItem = {
  id: string;
  name: string;
  status: string; // "active" | "disabled"
  employeeNumber: string | null;
};

export default function EmployeeSearchSwitcher({
  employees,
  currentUserId,
}: {
  employees: EmployeeListItem[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees.slice(0, 10);
    return employees
      .filter((e) => {
        const num = (e.employeeNumber ?? "").toLowerCase();
        return e.name.toLowerCase().includes(q) || num.includes(q);
      })
      .slice(0, 10);
  }, [employees, query]);

  const go = (id: string) => {
    setOpen(false);
    setQuery("");
    if (id !== currentUserId) {
      router.push(`/admin/users/${id}`);
    }
  };

  return (
    <div className="relative w-72">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // ドロップダウン項目クリックを拾うため少し遅延
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder="社員番号・氏名で検索して切替"
        className="w-full border-0 border-b border-gray-300 rounded-none px-0 py-1 text-[13px] bg-transparent focus:ring-0 focus:border-blue-600 focus:outline-none"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {matches.map((e) => {
            const isCurrent = e.id === currentUserId;
            const isDisabled = e.status !== "active";
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => {
                    // onBlur より先に発火させる
                    ev.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    go(e.id);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-blue-50 ${
                    isCurrent ? "bg-gray-50 text-gray-400" : "text-slate-700"
                  }`}
                >
                  <span className="font-mono text-[12px] text-gray-500 shrink-0">
                    {e.employeeNumber ?? "—"}
                  </span>
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-gray-400">
                    {isDisabled && <span>退社</span>}
                    {isCurrent && <span>表示中</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

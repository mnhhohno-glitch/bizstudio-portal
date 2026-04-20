"use client";

import { useState, useRef, useEffect } from "react";

export default function TopBar({
  userName,
}: {
  companyName?: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initial = userName.charAt(0);

  return (
    <div ref={ref} className="fixed top-2 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-7 h-7 rounded-full bg-[#2563EB] text-white text-[12px] font-bold cursor-pointer hover:bg-[#1D4ED8] transition-colors shadow-sm"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[160px]">
          <div className="px-3 py-2 text-[13px] font-medium text-gray-700 border-b border-gray-100">
            {userName}
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-[13px] text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              ログアウト
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

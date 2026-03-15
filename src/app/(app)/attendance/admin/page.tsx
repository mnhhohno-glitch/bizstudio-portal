"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function AttendanceAdminPage() {
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/attendance/admin/approvals")
      .then((r) => r.json())
      .then((d) => setPendingCount(d.pending?.length ?? 0))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-[18px] font-bold text-[#1E3A8A]">勤怠管理（管理者）</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/attendance/admin/approvals"
          className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#2563EB]/30 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-[24px]">📋</span>
            <div>
              <p className="text-[14px] font-bold text-[#374151]">承認待ち</p>
              <p className="text-[24px] font-bold text-[#2563EB]">
                {loading ? "..." : pendingCount}
                <span className="ml-1 text-[14px] text-[#6B7280]">件</span>
              </p>
            </div>
          </div>
        </Link>

        <Link href="/attendance/admin/employees"
          className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#2563EB]/30 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-[24px]">👤</span>
            <div>
              <p className="text-[14px] font-bold text-[#374151]">従業員管理</p>
              <p className="text-[13px] text-[#6B7280]">有給付与・残日数管理</p>
            </div>
          </div>
        </Link>

        <Link href="/attendance/admin/export"
          className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#2563EB]/30 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-[24px]">📊</span>
            <div>
              <p className="text-[14px] font-bold text-[#374151]">月次エクスポート</p>
              <p className="text-[13px] text-[#6B7280]">Excel出力</p>
            </div>
          </div>
        </Link>
        <Link href="/attendance/admin/import"
          className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#2563EB]/30 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-[24px]">📥</span>
            <div>
              <p className="text-[14px] font-bold text-[#374151]">データインポート</p>
              <p className="text-[13px] text-[#6B7280]">過去データの一括取込</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

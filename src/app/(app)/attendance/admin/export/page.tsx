"use client";

import { useState } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";

export default function ExportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/attendance/export?year=${year}&month=${month}`);
      if (!res.ok) {
        const d = await res.json();
        toast.error(d.error || "ダウンロードに失敗しました");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ビズスタジオ勤怠データ${year}${String(month).padStart(2, "0")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("ダウンロードしました");
    } catch {
      toast.error("ダウンロードに失敗しました");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Toaster position="top-center" richColors />
      <div className="mb-6 flex items-center gap-3">
        <Link href="/attendance/admin" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 管理者メニュー</Link>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">月次勤怠データエクスポート</h1>
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-[14px] font-medium text-[#374151]">対象年月</label>
            <div className="flex items-center gap-3">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]">
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-[6px] bg-[#F9FAFB] p-4">
            <p className="text-[13px] text-[#6B7280]">
              ファイル名: <span className="font-mono font-medium text-[#374151]">
                ビズスタジオ勤怠データ{year}{String(month).padStart(2, "0")}.xlsx
              </span>
            </p>
            <p className="mt-1 text-[12px] text-[#9CA3AF]">
              全社員の当月分勤怠データ（14列）をExcel形式で出力します
            </p>
          </div>

          <button onClick={handleDownload} disabled={downloading}
            className="w-full rounded-[8px] bg-[#2563EB] py-3 text-[14px] font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {downloading ? "ダウンロード中..." : "Excelをダウンロード"}
          </button>
        </div>
      </div>
    </div>
  );
}

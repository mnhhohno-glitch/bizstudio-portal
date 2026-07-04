"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import ScoutNav from "@/components/scout/ScoutNav";
import DeliveryDateView from "./_components/DeliveryDateView";
import AppliedDateView from "./_components/AppliedDateView";
import MediaView from "./_components/MediaView";

// T-135 T-C: 配信日別 / 応募日別 / 媒体別 を画面内トグルで切り替える統合ページ。
// 旧 /scout/by-sent /by-applied /by-media はここへリダイレクトされる（?view= で初期トグル）。
type View = "sent" | "applied" | "media";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
/** JST の当日 YYYY-MM-DD（罠#17） */
function jstToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
/**
 * baseYmd（YYYY-MM-DD）が属する月から delta ヶ月ずらした月の 1日〜末日 を返す。
 * 月末日数差（28/30/31）は new Date(y, m, 0) で吸収（m は 1-12、0日=前月末日）。
 */
function snapMonth(baseYmd: string, delta: number): { from: string; to: string } {
  const [y0, m0] = baseYmd.split("-").map(Number);
  let y = y0;
  let m = m0 + delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

const VIEW_LABELS: Record<View, string> = {
  sent: "配信日別",
  applied: "応募日別",
  media: "媒体別",
};

export default function ScoutAnalyticsPage() {
  const searchParams = useSearchParams();
  const initialView = ((): View => {
    const v = searchParams.get("view");
    return v === "applied" || v === "media" ? v : "sent";
  })();

  const [view, setView] = useState<View>(initialView);
  // 期間は3ビュー共通（トグル切替時も保持）
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());

  const applySnap = (snap: { from: string; to: string }) => {
    setFrom(snap.from);
    setTo(snap.to);
  };

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">集計</h1>

      {/* ビュー切替トグル */}
      <div className="mt-3 inline-flex rounded-lg border border-[#E5E7EB] bg-white p-1">
        {(["sent", "applied", "media"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
              view === v ? "bg-[#2563EB] text-white" : "text-[#6B7280] hover:text-[#374151]"
            }`}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      {/* 期間コントロール（3ビュー共通） */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
        <label className="text-[12px] text-[#6B7280]">期間:</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        />
        <span>〜</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        />
        {/* ◀｜当月｜▶（カレンダー月スナップ。◀▶ は終了日が属する月を基準に前後の月へ） */}
        <div className="ml-2 flex rounded-md border border-[#E5E7EB]">
          <button
            onClick={() => applySnap(snapMonth(to, -1))}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-l-md text-[14px] text-[#6B7280] hover:bg-[#F9FAFB]"
            title="前月"
          >
            ◀
          </button>
          <button
            onClick={() => applySnap(snapMonth(jstToday(), 0))}
            className="flex h-[30px] items-center justify-center border-x border-[#E5E7EB] px-3 text-[12px] text-[#6B7280] hover:bg-[#F9FAFB]"
            title="当月"
          >
            当月
          </button>
          <button
            onClick={() => applySnap(snapMonth(to, 1))}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-r-md text-[14px] text-[#6B7280] hover:bg-[#F9FAFB]"
            title="翌月"
          >
            ▶
          </button>
        </div>
      </div>

      {view === "sent" ? (
        <DeliveryDateView from={from} to={to} />
      ) : view === "applied" ? (
        <AppliedDateView from={from} to={to} />
      ) : (
        <MediaView from={from} to={to} />
      )}
    </div>
  );
}

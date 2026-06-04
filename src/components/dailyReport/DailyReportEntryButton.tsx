"use client";

// T-066: 日報フローの入口ボタン（「📝 日報を作る」）。
// SchedulePanel と並ぶ位置に置く。クリックで DailyReportChatDrawer を開く。

import { useState } from "react";
import DailyReportChatDrawer from "./DailyReportChatDrawer";
import { todayJstDateStringClient } from "./jstClient";

export default function DailyReportEntryButton() {
  const [open, setOpen] = useState(false);
  const date = todayJstDateStringClient();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#2563EB] text-[#2563EB] hover:bg-[#EFF6FF] px-3 py-2 text-[13px] font-medium"
      >
        📝 日報を作る
      </button>
      <DailyReportChatDrawer isOpen={open} onClose={() => setOpen(false)} date={date} />
    </>
  );
}

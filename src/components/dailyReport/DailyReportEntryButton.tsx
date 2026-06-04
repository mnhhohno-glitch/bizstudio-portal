"use client";

// T-066: 日報フローの入口ボタン（「📝 日報を作る」）。
// SchedulePanel の中（フッター）に置かれ、パネルが選択中の日付（currentDate）を
// "YYYY-MM-DD" で受け取って DailyReportChatDrawer にそのまま渡す。
// 本コンポーネントは date を内部で生成しない（過去日選択時のずれ防止）。

import { useState } from "react";
import DailyReportChatDrawer from "./DailyReportChatDrawer";

interface Props {
  /** JST の "YYYY-MM-DD"。SchedulePanel.currentDate を toDateString した結果を渡す。 */
  date: string;
}

export default function DailyReportEntryButton({ date }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-md border border-[#2563EB] text-[#2563EB] hover:bg-blue-50 px-3 py-2 text-[13px] font-medium transition-colors"
      >
        📝 日報を作る
      </button>
      <DailyReportChatDrawer isOpen={open} onClose={() => setOpen(false)} date={date} />
    </>
  );
}

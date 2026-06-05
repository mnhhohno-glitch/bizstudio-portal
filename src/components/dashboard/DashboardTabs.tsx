"use client";

// T-066 Phase 5: ダッシュボード 3 タブ化（「スケジュール（日報）」｜「タスク」｜「お知らせ」）。
// データ取得は Server Component で行い、ここはタブ切替のみ担当する（R8）。
// 各タブの中身は children と分けて props で受け取る。
//
// feature flag が OFF のときはこのコンポーネントを使わず、page.tsx 側で従来表示にフォールバックする。

import { useState, type ReactNode } from "react";

type TabKey = "schedule" | "performance" | "tasks" | "announcements";

interface Props {
  scheduleTab: ReactNode;
  performanceTab: ReactNode;
  tasksTab: ReactNode;
  announcementsTab: ReactNode;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "schedule", label: "スケジュール（日報）" },
  { key: "performance", label: "実績表" },
  { key: "tasks", label: "タスク" },
  { key: "announcements", label: "お知らせ" },
];

export default function DashboardTabs({ scheduleTab, performanceTab, tasksTab, announcementsTab }: Props) {
  const [active, setActive] = useState<TabKey>("schedule");
  return (
    <div className="mt-4">
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              active === t.key
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-[#6B7280] hover:text-[#374151]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {active === "schedule" && scheduleTab}
        {active === "performance" && performanceTab}
        {active === "tasks" && tasksTab}
        {active === "announcements" && announcementsTab}
      </div>
    </div>
  );
}

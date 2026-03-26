"use client";

import ScheduleEntryCard from "./ScheduleEntryCard";
import type { ScheduleEntryCardProps } from "./ScheduleEntryCard";

interface DailyTimelineProps {
  entries: ScheduleEntryCardProps[];
  summary?: string | null;
}

export default function DailyTimeline({ entries, summary }: DailyTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-[#9CA3AF]">
        スケジュール未作成
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <ScheduleEntryCard key={i} {...entry} />
        ))}
      </div>
    </div>
  );
}

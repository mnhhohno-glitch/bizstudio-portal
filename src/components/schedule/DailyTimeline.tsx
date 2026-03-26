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
      {summary && (
        <p className="text-[12px] text-[#6B7280] mb-3 bg-[#F3F4F6] rounded-md px-3 py-2">
          {summary}
        </p>
      )}
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <ScheduleEntryCard key={i} {...entry} />
        ))}
      </div>
    </div>
  );
}

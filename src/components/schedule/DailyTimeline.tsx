"use client";

import ScheduleEntryCard from "./ScheduleEntryCard";
import type { ScheduleEntryCardProps } from "./ScheduleEntryCard";
import NowIndicator, { getCurrentTimeJST } from "./NowIndicator";
import { useState, useEffect } from "react";

interface DailyTimelineProps {
  entries: ScheduleEntryCardProps[];
  summary?: string | null;
  isToday?: boolean;
}

export default function DailyTimeline({ entries, isToday = false }: DailyTimelineProps) {
  const [now, setNow] = useState(getCurrentTimeJST);

  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => setNow(getCurrentTimeJST()), 60000);
    return () => clearInterval(interval);
  }, [isToday]);

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-[#9CA3AF]">
        スケジュール未作成
      </div>
    );
  }

  if (!isToday) {
    return (
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <ScheduleEntryCard key={i} {...entry} />
        ))}
      </div>
    );
  }

  // Insert NowIndicator at the right position
  const elements: React.ReactNode[] = [];
  let nowInserted = false;

  entries.forEach((entry, i) => {
    const isActive = !nowInserted && now >= entry.startTime && now < entry.endTime;

    if (!nowInserted && now < entry.startTime) {
      elements.push(<NowIndicator key="now" />);
      nowInserted = true;
    }

    elements.push(
      <ScheduleEntryCard key={i} {...entry} isActive={isActive} />
    );

    if (isActive) {
      elements.push(<NowIndicator key="now" />);
      nowInserted = true;
    }
  });

  if (!nowInserted) {
    elements.push(<NowIndicator key="now" />);
  }

  return <div className="space-y-1">{elements}</div>;
}

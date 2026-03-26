"use client";

interface ScheduleProgressBarProps {
  completed: number;
  total: number;
}

export default function ScheduleProgressBar({ completed, total }: ScheduleProgressBarProps) {
  if (total === 0) return null;
  const pct = Math.round((completed / total) * 100);
  const isAllDone = completed === total;

  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isAllDone ? "bg-green-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-[#6B7280] shrink-0">
        {completed}/{total} 完了
      </span>
    </div>
  );
}

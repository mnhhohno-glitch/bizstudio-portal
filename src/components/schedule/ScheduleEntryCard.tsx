"use client";

export interface ScheduleEntryCardProps {
  startTime: string;
  endTime: string;
  title: string;
  note?: string | null;
  tag: string;
  tagColor: string;
}

export default function ScheduleEntryCard({
  startTime,
  endTime,
  title,
  note,
  tag,
  tagColor,
}: ScheduleEntryCardProps) {
  return (
    <div className="flex bg-[#F9FAFB] rounded-lg overflow-hidden">
      {/* Time column + color bar */}
      <div
        className="shrink-0 flex items-center justify-center px-2 py-1.5 text-[11px] text-[#6B7280] border-r-[3px] whitespace-nowrap"
        style={{ borderRightColor: tagColor }}
      >
        <span className="font-medium">{startTime}</span>
        <span className="mx-0.5">→</span>
        <span className="font-medium">{endTime}</span>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-between px-3 py-2 min-w-0 gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#374151] truncate">{title}</p>
          {note && (
            <p className="text-[11px] text-[#9CA3AF] truncate mt-0.5">{note}</p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: tagColor }}
        >
          {tag}
        </span>
      </div>
    </div>
  );
}

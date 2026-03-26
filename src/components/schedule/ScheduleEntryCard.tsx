"use client";

export interface ScheduleEntryCardProps {
  startTime: string;
  endTime: string;
  title: string;
  note?: string | null;
  tag: string;
  tagColor: string;
  isActive?: boolean;
  isCompleted?: boolean;
  entryId?: string;
  canComplete?: boolean;
  onToggleComplete?: (entryId: string) => void;
}

export default function ScheduleEntryCard({
  startTime,
  endTime,
  title,
  note,
  tag,
  tagColor,
  isActive = false,
  isCompleted = false,
  entryId,
  canComplete = false,
  onToggleComplete,
}: ScheduleEntryCardProps) {
  return (
    <div className={`flex rounded-lg overflow-hidden ${isActive ? "bg-blue-50 ring-1 ring-blue-200" : "bg-[#F9FAFB]"} ${isCompleted ? "opacity-50" : ""}`}>
      {/* Checkbox */}
      {canComplete && entryId && (
        <div className="flex items-center pl-2">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={() => onToggleComplete?.(entryId)}
            className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
          />
        </div>
      )}

      {/* Time column + color bar */}
      <div
        className={`shrink-0 flex items-center justify-center px-2 py-1.5 text-[11px] text-[#6B7280] whitespace-nowrap ${isActive ? "border-r-[4px]" : "border-r-[3px]"}`}
        style={{ borderRightColor: tagColor }}
      >
        <span className="font-medium">{startTime}</span>
        <span className="mx-0.5">→</span>
        <span className="font-medium">{endTime}</span>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-between px-3 py-1.5 min-w-0 gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-[13px] font-semibold text-[#374151] truncate ${isCompleted ? "line-through" : ""}`}>{title}</p>
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

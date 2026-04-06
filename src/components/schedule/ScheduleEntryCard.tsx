"use client";

import React from "react";

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
  canEdit?: boolean;
  canDrag?: boolean;
  onToggleComplete?: (entryId: string) => void;
  onEdit?: (entryId: string) => void;
  onDelete?: (entryId: string) => void;
  dragHandleProps?: Record<string, unknown>;
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
  canEdit = false,
  canDrag = false,
  onToggleComplete,
  onEdit,
  onDelete,
  dragHandleProps,
}: ScheduleEntryCardProps) {
  return (
    <div className={`group flex rounded-lg overflow-hidden transition-colors ${isActive ? "bg-blue-50 ring-1 ring-blue-200" : "bg-[#F9FAFB] hover:bg-gray-100"} ${isCompleted ? "opacity-50" : ""}`}>
      {/* Drag handle */}
      {canDrag && (
        <div
          {...dragHandleProps}
          className="flex items-center pl-1.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none"
          title="ドラッグして並び替え"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="3" r="1.2" />
            <circle cx="11" cy="3" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="13" r="1.2" />
            <circle cx="11" cy="13" r="1.2" />
          </svg>
        </div>
      )}

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
      <div className="flex-1 flex items-center justify-between px-3 py-1.5 min-w-0 gap-1">
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
        {/* Edit/Delete buttons - visible on hover */}
        {canEdit && entryId && (
          <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit?.(entryId); }}
              className="text-blue-500 hover:text-blue-700 p-0.5"
              title="編集"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(entryId); }}
              className="text-red-400 hover:text-red-600 p-0.5"
              title="削除"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { getOvertimeBadge, formatHoursMinutes } from "@/lib/attendance/overtime-projection";
import type { SalaryRange } from "@prisma/client";

type OvertimeProjection = {
  projectedOvertime: number | null;
  avgDailyOvertime: number | null;
  businessDays: number;
  workDays: number;
  totalOvertime: number;
  salaryRange: SalaryRange;
};

const BADGE_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", label: "順調" },
  yellow: { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-800", label: "注意" },
  red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", label: "警告" },
  darkred: { bg: "bg-red-100", border: "border-red-300", text: "text-red-900", label: "危険" },
  gray: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", label: "判定待ち" },
};

export default function OvertimeProjectionCard({ data }: { data: OvertimeProjection | null }) {
  if (!data) return null;

  const { badge, message } = getOvertimeBadge(data.projectedOvertime, data.workDays, data.salaryRange);
  const style = BADGE_STYLES[badge];
  const rangeLabel = data.salaryRange === "SALES" ? "営業レンジ (30h)" : "事務レンジ (15h)";
  const displaySeconds = data.projectedOvertime !== null && data.projectedOvertime > 0 ? data.projectedOvertime : 0;

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[14px] font-bold text-[#374151]">月見込み残業</h3>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${style.bg} ${style.text} border ${style.border}`}>
          {style.label}
        </span>
      </div>
      <div className="mb-2">
        <span className={`text-[22px] font-bold tabular-nums ${style.text}`}>
          {badge === "gray" ? "-" : formatHoursMinutes(displaySeconds)}
        </span>
        <span className="ml-2 text-[12px] text-[#6B7280]">{rangeLabel}</span>
      </div>
      <p className={`text-[12px] ${style.text}`}>{message}</p>
      {badge !== "gray" && (
        <div className="mt-2 flex gap-4 text-[11px] text-[#6B7280]">
          <span>実績残業: {formatHoursMinutes(data.totalOvertime)}</span>
          <span>出勤日数: {data.workDays}日 / {data.businessDays}営業日</span>
        </div>
      )}
    </div>
  );
}

"use client";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "未出勤", color: "bg-gray-100 text-gray-600" },
  WORKING: { label: "勤務中", color: "bg-green-100 text-green-700" },
  ON_BREAK: { label: "休憩中", color: "bg-blue-100 text-blue-700" },
  INTERRUPTED: { label: "中断中", color: "bg-amber-100 text-amber-700" },
  FINISHED: { label: "退勤済み", color: "bg-gray-100 text-gray-600" },
};

type Props = {
  status: string;
  clockIn?: string | null;
};

export default function StatusBadge({ status, clockIn }: Props) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.NOT_STARTED;
  const clockInStr = clockIn
    ? new Date(clockIn).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-4 text-center">
      <span className={`inline-block rounded-full px-4 py-1.5 text-[14px] font-medium ${config.color}`}>
        {config.label}
      </span>
      {clockInStr && (
        <p className="mt-2 text-[13px] text-[#6B7280]">出勤: {clockInStr}</p>
      )}
    </div>
  );
}

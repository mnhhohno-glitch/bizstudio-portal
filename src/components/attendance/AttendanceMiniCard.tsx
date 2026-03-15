"use client";

import Link from "next/link";

type Props = {
  status: string | null;
  clockIn: string | null;
  clockOut: string | null;
  totalWork: number;
  totalBreak: number;
};

const STATUS_DOT: Record<string, string> = {
  NOT_STARTED: "bg-gray-400",
  WORKING: "bg-green-500",
  ON_BREAK: "bg-blue-500",
  INTERRUPTED: "bg-amber-500",
  FINISHED: "bg-gray-400",
};
const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未出勤",
  WORKING: "勤務中",
  ON_BREAK: "休憩中",
  INTERRUPTED: "中断中",
  FINISHED: "退勤済",
};

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

export default function AttendanceMiniCard({ status, clockIn, clockOut, totalWork, totalBreak }: Props) {
  const st = status ?? "NOT_STARTED";
  const dot = STATUS_DOT[st] ?? "bg-gray-400";
  const label = STATUS_LABEL[st] ?? st;
  const isWorking = st === "WORKING" || st === "ON_BREAK" || st === "INTERRUPTED";
  const isFinished = st === "FINISHED";

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[14px] font-medium text-[#374151]">本日の勤怠</h2>
        {st === "NOT_STARTED" ? (
          <Link href="/attendance" className="rounded-lg bg-green-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-green-700">
            出勤する
          </Link>
        ) : isWorking ? (
          <Link href="/attendance" className="rounded-lg bg-[#2563EB] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-[#1D4ED8]">
            打刻画面へ
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {isFinished ? (
          <span className="text-green-600 text-[14px]">✓</span>
        ) : (
          <span className={`h-2 w-2 rounded-full ${dot}`} />
        )}
        <span className="text-[14px] font-medium text-[#374151]">{label}</span>
        {clockIn && (
          <span className="text-[13px] text-[#6B7280] ml-1">
            {isFinished && clockOut
              ? `${fmtTime(clockIn)}〜${fmtTime(clockOut)}`
              : `出勤 ${fmtTime(clockIn)}`}
          </span>
        )}
      </div>

      {(isWorking || isFinished) && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="rounded-lg bg-[#F9FAFB] px-3 py-2">
            <p className="text-[11px] text-[#9CA3AF]">勤務時間</p>
            <p className="text-[15px] font-medium tabular-nums text-[#374151]">{fmt(totalWork)}</p>
          </div>
          <div className="rounded-lg bg-[#F9FAFB] px-3 py-2">
            <p className="text-[11px] text-[#9CA3AF]">休憩</p>
            <p className="text-[15px] font-medium tabular-nums text-[#374151]">{fmt(totalBreak)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

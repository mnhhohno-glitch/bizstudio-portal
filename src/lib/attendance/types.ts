import type { AttendanceStatus, PunchType } from "@prisma/client";

export type { AttendanceStatus, PunchType };

export type ValidationError = {
  code: "NO_BREAK_OVER_6H" | "BREAK_NOT_ENDED" | "INTERRUPT_NOT_ENDED";
  message: string;
};

export type ValidationResult = {
  canClockOut: boolean;
  errors: ValidationError[];
};

export type DailyTotals = {
  totalBreak: number;       // 休憩合計（秒）
  totalInterrupt: number;   // 中断合計（秒）
  totalWork: number;        // 実労働時間（秒）
  overtime: number;         // 残業時間（秒）
  overtimeRounded: number;  // 残業 分単位切り捨て（秒）
  nightTime: number;        // 深夜時間（秒）
  note: string | null;      // 備考
};

export type AlertType =
  | "NO_CLOCK_IN"
  | "NO_CLOCK_OUT"
  | "BREAK_NOT_ENDED"
  | "INTERRUPT_NOT_ENDED"
  | "NO_BREAK_OVER_6H";

export type Alert = {
  id: string;
  date: Date;
  type: AlertType;
  message: string;
  dailyAttendanceId: string;
};

/** 秒数 → "H:MM:SS" 表示 */
export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 秒数 → "H:MM" 表示（分単位） */
export function formatMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

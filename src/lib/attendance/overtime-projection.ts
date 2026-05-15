import type { SalaryRange } from "@prisma/client";

export type OvertimeBadge = "green" | "yellow" | "red" | "darkred" | "gray";

const THRESHOLDS: Record<SalaryRange, [number, number, number] | null> = {
  SALES: [10, 20, 30],
  OFFICE: [5, 12, 15],
  PART_TIME: null,
  MANAGEMENT: null,
};

const MESSAGES: Record<OvertimeBadge, string> = {
  green: "順調なペースです。このまま継続しましょう",
  yellow: "残業ペースに注意。生産性アップを意識しましょう",
  red: "このままでは超過してしまいます。残業を抑えるための生産性アップを考え業務改善をしていきましょう",
  darkred: "法定上限超過のリスクがあります。至急業務見直しを",
  gray: "データ蓄積中。出勤実績ができ次第判定します",
};

export function getOvertimeBadge(
  projectedOvertime: number | null,
  workDays: number,
  salaryRange: SalaryRange,
): { badge: OvertimeBadge; message: string } {
  if (projectedOvertime === null || workDays < 3) {
    return { badge: "gray", message: MESSAGES.gray };
  }
  if (projectedOvertime < 0) {
    return { badge: "green", message: MESSAGES.green };
  }
  const thresholds = THRESHOLDS[salaryRange];
  if (!thresholds) {
    return { badge: "gray", message: MESSAGES.gray };
  }
  const hours = projectedOvertime / 3600;
  const [g, y, r] = thresholds;
  if (hours <= g) return { badge: "green", message: MESSAGES.green };
  if (hours <= y) return { badge: "yellow", message: MESSAGES.yellow };
  if (hours <= r) return { badge: "red", message: MESSAGES.red };
  return { badge: "darkred", message: MESSAGES.darkred };
}

export function formatHoursMinutes(seconds: number): string {
  if (seconds <= 0) return "0時間0分";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}時間${m}分`;
}

import { prisma } from "@/lib/prisma";
import type { ValidationResult } from "./types";
import { nowJST, toJST } from "./timezone";

/**
 * 退勤時バリデーション
 * 3つのチェックを行い、1つでも引っかかれば退勤をブロックする
 */
export async function validateClockOut(
  dailyAttendanceId: string
): Promise<ValidationResult> {
  const errors: ValidationResult["errors"] = [];

  const attendance = await prisma.dailyAttendance.findUnique({
    where: { id: dailyAttendanceId },
    include: { punchEvents: { orderBy: { timestamp: "asc" } } },
  });

  if (!attendance || !attendance.clockIn) {
    return { canClockOut: false, errors: [{ code: "NO_BREAK_OVER_6H", message: "出勤情報がありません" }] };
  }

  const punches = attendance.punchEvents;
  const now = nowJST();
  const clockIn = toJST(attendance.clockIn);

  // 1. 休憩終了の押し忘れ
  const breakStarts = punches.filter((p) => p.type === "BREAK_START").length;
  const breakEnds = punches.filter((p) => p.type === "BREAK_END").length;
  if (breakStarts > breakEnds) {
    errors.push({ code: "BREAK_NOT_ENDED", message: "休憩終了を先に押してください" });
  }

  // 2. 中断終了の押し忘れ
  const intStarts = punches.filter((p) => p.type === "INTERRUPT_START").length;
  const intEnds = punches.filter((p) => p.type === "INTERRUPT_END").length;
  if (intStarts > intEnds) {
    errors.push({ code: "INTERRUPT_NOT_ENDED", message: "中断終了を先に押してください" });
  }

  // 3. 6時間超勤務で休憩未登録
  if (breakStarts === 0) {
    let interruptSeconds = 0;
    const intStartPunches = punches.filter((p) => p.type === "INTERRUPT_START");
    const intEndPunches = punches.filter((p) => p.type === "INTERRUPT_END");
    for (let i = 0; i < Math.min(intStartPunches.length, intEndPunches.length); i++) {
      interruptSeconds += toJST(intEndPunches[i].timestamp).diff(toJST(intStartPunches[i].timestamp), "second");
    }

    const totalElapsed = now.diff(clockIn, "second");
    const effectiveWork = totalElapsed - interruptSeconds;

    if (effectiveWork > 6 * 3600) {
      errors.push({ code: "NO_BREAK_OVER_6H", message: "休憩を登録してから退勤してください" });
    }
  }

  return { canClockOut: errors.length === 0, errors };
}

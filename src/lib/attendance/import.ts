import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { dayjs, TZ } from "./timezone";

type ImportResult = {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
  employeeSummary: { empNo: string; name: string; imported: number; skipped: number }[];
};

/** Excel Date (1899ベース) から時:分:秒を抽出 */
function extractTime(val: unknown): { hours: number; minutes: number; seconds: number } | null {
  if (val == null) return null;
  if (val instanceof Date) {
    // ExcelJS は時刻を 1899-12-30 ベースの Date として返す
    // getHours/getMinutes/getSeconds で時刻部分を取得
    return { hours: val.getHours(), minutes: val.getMinutes(), seconds: val.getSeconds() };
  }
  if (typeof val === "number") {
    // Excel シリアル値 (0~1)
    const totalSec = Math.round(val * 86400);
    return { hours: Math.floor(totalSec / 3600), minutes: Math.floor((totalSec % 3600) / 60), seconds: totalSec % 60 };
  }
  if (typeof val === "string" && val.includes(":")) {
    const parts = val.split(":").map(Number);
    return { hours: parts[0] ?? 0, minutes: parts[1] ?? 0, seconds: parts[2] ?? 0 };
  }
  return null;
}

/** 時刻を秒数に変換 */
function timeToSeconds(val: unknown): number {
  const t = extractTime(val);
  if (!t) return 0;
  return t.hours * 3600 + t.minutes * 60 + t.seconds;
}

/** 出勤日(Date) + 時刻(Excel Date) を JST DateTime に結合 */
function combineDateAndTime(dateVal: Date, timeVal: unknown): Date | null {
  const t = extractTime(timeVal);
  if (!t) return null;
  const d = dayjs(dateVal).tz(TZ).startOf("day");
  return d.hour(t.hours).minute(t.minutes).second(t.seconds).toDate();
}

/** JST日付をDB用に変換 (UTC同日00:00:00Z) */
function dateForDBFromDate(d: Date): Date {
  const jst = dayjs(d).tz(TZ);
  return new Date(jst.format("YYYY-MM-DD") + "T00:00:00.000Z");
}

export async function importAttendanceFromExcel(buffer: Buffer): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(1);
  if (!ws) throw new Error("Sheet1 が見つかりません");

  const cutoffDate = new Date("2026-03-01T00:00:00+09:00");
  const result: ImportResult = { totalRows: 0, imported: 0, skipped: 0, errors: [], employeeSummary: [] };
  const empSummaryMap = new Map<string, { name: string; imported: number; skipped: number }>();

  // Collect rows by employee
  const rowsByEmp = new Map<string, { empNo: string; name: string; rows: ExcelJS.Row[] }>();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const empNo = String(row.getCell(1).value ?? "").trim();
    if (!empNo) continue;
    result.totalRows++;

    // Skip invalid employee
    if (empNo === "BS1000008xx") { result.skipped++; continue; }

    // Skip 2026/03+
    const dateVal = row.getCell(3).value;
    if (dateVal instanceof Date && dateVal >= cutoffDate) { result.skipped++; continue; }

    const name = String(row.getCell(2).value ?? "").trim();
    if (!rowsByEmp.has(empNo)) rowsByEmp.set(empNo, { empNo, name, rows: [] });
    rowsByEmp.get(empNo)!.rows.push(row);
  }

  // Process per employee (separate transactions)
  for (const [empNo, group] of rowsByEmp) {
    const summary = { name: group.name, imported: 0, skipped: 0 };
    empSummaryMap.set(empNo, summary);

    try {
      // Find or create Employee
      let employee = await prisma.employee.findUnique({ where: { employeeNumber: empNo } });
      if (!employee) {
        employee = await prisma.employee.create({
          data: { employeeNumber: empNo, name: group.name, status: "active" },
        });
      }

      // Process rows in batches
      for (const row of group.rows) {
        try {
          const dateVal = row.getCell(3).value as Date;
          if (!dateVal || !(dateVal instanceof Date)) { summary.skipped++; result.skipped++; continue; }

          const dbDate = dateForDBFromDate(dateVal);

          // Check if already exists
          const existing = await prisma.dailyAttendance.findUnique({
            where: { employeeId_date: { employeeId: employee.id, date: dbDate } },
          });
          if (existing) { summary.skipped++; result.skipped++; continue; }

          const clockInVal = row.getCell(5).value;
          const clockOutVal = row.getCell(6).value;
          const hasWork = clockInVal != null;

          const clockIn = hasWork ? combineDateAndTime(dateVal, clockInVal) : null;
          const clockOut = hasWork ? combineDateAndTime(dateVal, clockOutVal) : null;

          const totalBreak = timeToSeconds(row.getCell(9).value);
          const totalInterrupt = timeToSeconds(row.getCell(10).value);
          const overtime = timeToSeconds(row.getCell(11).value);
          const nightTime = timeToSeconds(row.getCell(12).value);

          // Calculate total work
          let totalWork = 0;
          if (clockIn && clockOut) {
            const grossWork = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000);
            totalWork = Math.max(0, grossWork - totalBreak - totalInterrupt);
          }

          // Create DailyAttendance
          const attendance = await prisma.dailyAttendance.create({
            data: {
              employeeId: employee.id,
              date: dbDate,
              status: hasWork ? "FINISHED" : "NOT_STARTED",
              clockIn,
              clockOut,
              totalBreak,
              totalInterrupt,
              totalWork,
              overtime,
              overtimeRounded: overtime, // Import data is already rounded
              nightTime,
              isFinalized: hasWork,
              updatedAt: new Date(),
            },
          });

          // Create PunchEvents
          if (hasWork) {
            const events: {
              employeeId: string;
              dailyAttendanceId: string;
              type: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT";
              timestamp: Date;
            }[] = [];

            if (clockIn) events.push({ employeeId: employee.id, dailyAttendanceId: attendance.id, type: "CLOCK_IN", timestamp: clockIn });

            const breakStartVal = row.getCell(7).value;
            const breakEndVal = row.getCell(8).value;
            if (breakStartVal) {
              const bs = combineDateAndTime(dateVal, breakStartVal);
              if (bs) events.push({ employeeId: employee.id, dailyAttendanceId: attendance.id, type: "BREAK_START", timestamp: bs });
            }
            if (breakEndVal) {
              const be = combineDateAndTime(dateVal, breakEndVal);
              if (be) events.push({ employeeId: employee.id, dailyAttendanceId: attendance.id, type: "BREAK_END", timestamp: be });
            }

            if (clockOut) events.push({ employeeId: employee.id, dailyAttendanceId: attendance.id, type: "CLOCK_OUT", timestamp: clockOut });

            if (events.length > 0) {
              await prisma.punchEvent.createMany({ data: events });
            }
          }

          summary.imported++;
          result.imported++;
        } catch (e) {
          summary.skipped++;
          result.skipped++;
          result.errors.push(`${empNo} Row ${row.number}: ${String(e)}`);
          if (result.errors.length > 20) break; // Stop collecting errors after 20
        }
      }
    } catch (e) {
      result.errors.push(`Employee ${empNo}: ${String(e)}`);
    }
  }

  result.employeeSummary = [...empSummaryMap.entries()].map(([empNo, s]) => ({
    empNo, name: s.name, imported: s.imported, skipped: s.skipped,
  }));

  return result;
}

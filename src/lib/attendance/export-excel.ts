import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { toJST } from "./timezone";

function secondsToExcelTime(seconds: number): number {
  return seconds / 86400;
}

function dateTimeToExcelTime(dt: Date): number {
  const d = toJST(dt);
  return (d.hour() * 3600 + d.minute() * 60 + d.second()) / 86400;
}

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function generateMonthlyExcel(year: number, month: number): Promise<Buffer> {
  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    orderBy: { employeeNumber: "asc" },
  });

  // @db.Date は UTC 00:00:00 として保存されるため、UTC基準で比較する
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(year, month, 0).getDate();

  console.log("[Export] year:", year, "month:", month);
  console.log("[Export] startDate:", startDate.toISOString());
  console.log("[Export] endDate:", endDate.toISOString());

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("勤怠データ");

  // Headers
  const headers = [
    "社員NO",
    "勤怠打刻_社員NO::社員_氏名結合",
    "出勤日",
    "出勤曜日",
    "出勤時刻",
    "退勤時刻",
    "休憩開始時刻",
    "休憩終了時刻",
    "休憩合計",
    "中断合計",
    "残業時間",
    "残業時間",
    "深夜時間",
    "勤務時間_計",
  ];
  ws.addRow(headers);

  // Style header
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 10 };
  headerRow.alignment = { horizontal: "center" };

  // Column widths
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 8;
  for (let i = 5; i <= 14; i++) ws.getColumn(i).width = 12;

  for (const emp of employees) {
    const attendances = await prisma.dailyAttendance.findMany({
      where: {
        employeeId: emp.id,
        date: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: { punchEvents: { orderBy: { timestamp: "asc" } } },
    });

    const attMap = new Map(
      attendances.map((a) => [utcDateKey(a.date), a])
    );

    for (let d = 1; d <= daysInMonth; d++) {
      const targetDate = new Date(Date.UTC(year, month - 1, d));
      const dateStr = utcDateKey(targetDate);
      const att = attMap.get(dateStr);

      const row = ws.addRow([]);
      const r = ws.lastRow!;

      // A: 社員NO
      r.getCell(1).value = emp.employeeNumber;
      r.getCell(1).numFmt = "@";

      // B: 氏名
      r.getCell(2).value = emp.name;
      r.getCell(2).numFmt = "@";

      // C: 出勤日（UTC midnight = JST 09:00 なので日付は同じ）
      r.getCell(3).value = targetDate;
      r.getCell(3).numFmt = "yyyy/mm/dd";

      // D: 曜日
      r.getCell(4).value = `(${DAY_NAMES[targetDate.getUTCDay()]})`;
      r.getCell(4).numFmt = "@";

      if (att && att.clockIn) {
        // E: 出勤時刻
        r.getCell(5).value = dateTimeToExcelTime(att.clockIn);
        r.getCell(5).numFmt = "[hh]:mm:ss";

        // F: 退勤時刻
        if (att.clockOut) {
          r.getCell(6).value = dateTimeToExcelTime(att.clockOut);
          r.getCell(6).numFmt = "[hh]:mm:ss";
        }

        // G: 最初の休憩開始
        const breakStarts = att.punchEvents.filter((p) => p.type === "BREAK_START");
        const breakEnds = att.punchEvents.filter((p) => p.type === "BREAK_END");
        if (breakStarts.length > 0) {
          r.getCell(7).value = dateTimeToExcelTime(breakStarts[0].timestamp);
          r.getCell(7).numFmt = "[hh]:mm:ss";
        }

        // H: 最初の休憩終了
        if (breakEnds.length > 0) {
          r.getCell(8).value = dateTimeToExcelTime(breakEnds[0].timestamp);
          r.getCell(8).numFmt = "[hh]:mm:ss";
        }

        // I: 休憩合計
        if (att.totalBreak > 0) {
          r.getCell(9).value = secondsToExcelTime(att.totalBreak);
          r.getCell(9).numFmt = "h:mm;@";
        }

        // J: 中断合計
        if (att.totalInterrupt > 0) {
          r.getCell(10).value = secondsToExcelTime(att.totalInterrupt);
          r.getCell(10).numFmt = "h:mm;@";
        }

        // K: 残業時間（秒単位実績）
        r.getCell(11).value = att.overtime > 0 ? secondsToExcelTime(att.overtime) : secondsToExcelTime(0);
        r.getCell(11).numFmt = "h:mm;@";

        // L: 残業時間（分単位丸め）
        r.getCell(12).value = att.overtimeRounded > 0 ? secondsToExcelTime(att.overtimeRounded) : secondsToExcelTime(0);
        r.getCell(12).numFmt = "h:mm;@";

        // M: 深夜時間
        r.getCell(13).value = att.nightTime > 0 ? secondsToExcelTime(att.nightTime) : secondsToExcelTime(0);
        r.getCell(13).numFmt = "h:mm;@";

        // N: 勤務時間_計
        if (att.totalWork > 0) {
          r.getCell(14).value = secondsToExcelTime(att.totalWork);
          r.getCell(14).numFmt = "h:mm;@";
        }
      } else {
        // 勤務なしの日
        // 有給チェック
        if (att?.note) {
          r.getCell(14).value = att.note; // "有給" 等
          r.getCell(14).numFmt = "@";
        }
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

import ExcelJS from "exceljs";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("C:/Users/mnhho/OneDrive - 株式会社ビズスタジオ/デスクトップ/勤怠打刻20260315.xlsx");
  const ws = wb.getWorksheet(1)!;
  console.log(`Sheet: ${ws.name}, Rows: ${ws.rowCount}, Cols: ${ws.columnCount}`);

  // Header row
  const hdr = ws.getRow(1);
  for (let c = 1; c <= 13; c++) {
    console.log(`  Col ${c}: ${hdr.getCell(c).value}`);
  }

  // Sample rows 2-4
  for (let r = 2; r <= 4; r++) {
    const row = ws.getRow(r);
    const vals: string[] = [];
    for (let c = 1; c <= 13; c++) {
      const v = row.getCell(c).value;
      vals.push(`${typeof v}:${v}`);
    }
    console.log(`Row ${r}: ${vals.join(" | ")}`);
  }

  // Unique employee numbers
  const empMap = new Map<string, { name: string; count: number }>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const empNo = String(ws.getRow(r).getCell(1).value ?? "");
    const name = String(ws.getRow(r).getCell(2).value ?? "");
    if (!empNo) continue;
    const existing = empMap.get(empNo);
    if (existing) { existing.count++; }
    else { empMap.set(empNo, { name, count: 1 }); }
  }
  console.log("\nEmployee summary:");
  for (const [no, info] of empMap) {
    console.log(`  ${no} | ${info.name} | ${info.count} rows`);
  }
}

main().catch(console.error);

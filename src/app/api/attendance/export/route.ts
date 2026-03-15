import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateMonthlyExcel } from "@/lib/attendance/export-excel";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "年月が不正です" }, { status: 400 });
  }

  try {
    const buffer = await generateMonthlyExcel(year, month);
    const filename = `ビズスタジオ勤怠データ${year}${String(month).padStart(2, "0")}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    console.error("Excel出力エラー:", error);
    return NextResponse.json({ error: "Excel出力に失敗しました" }, { status: 500 });
  }
}

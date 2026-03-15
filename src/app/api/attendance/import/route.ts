import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { importAttendanceFromExcel } from "@/lib/attendance/import";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "ファイルが選択されていません" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importAttendanceFromExcel(buffer);

    return NextResponse.json(result);
  } catch (error) {
    console.error("インポートエラー:", error);
    return NextResponse.json({ error: "インポートに失敗しました" }, { status: 500 });
  }
}

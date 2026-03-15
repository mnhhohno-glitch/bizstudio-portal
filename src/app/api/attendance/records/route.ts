import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMonthlyRecords, getAvailableMonths, getEmployeeList } from "@/lib/attendance/records";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  // If no filters, return employee list and their months
  if (!employeeId) {
    const employees = await getEmployeeList();
    return NextResponse.json({ employees });
  }

  if (!year || !month) {
    const months = await getAvailableMonths(employeeId);
    return NextResponse.json({ months });
  }

  const { records, summary } = await getMonthlyRecords(employeeId, year, month);
  return NextResponse.json({ records, summary });
}

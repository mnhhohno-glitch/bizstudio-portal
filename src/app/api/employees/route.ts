import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/employees
 * 有効な社員一覧を返す（他アプリからの参照用）
 */
export async function GET() {
  try {
    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      orderBy: { employeeNumber: "asc" },
      select: {
        id: true,
        employeeNumber: true,
        name: true,
        status: true,
      },
    });

    // レスポンス形式を統一（employeeNo として返す）
    const response = employees.map((emp) => ({
      id: emp.id,
      employeeNo: emp.employeeNumber,
      name: emp.name,
      status: emp.status,
    }));

    return NextResponse.json(response, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
      },
    });
  } catch (error) {
    console.error("Failed to fetch employees:", error);
    return NextResponse.json(
      { error: "社員一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/employees
 * CORS preflight対応
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

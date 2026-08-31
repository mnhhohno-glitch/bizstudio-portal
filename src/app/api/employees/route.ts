import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
} as const;

/**
 * GET /api/employees
 * 有効な社員一覧を返す（他アプリからの参照用）
 *
 * - 既定（パラメータなし）: status="active" のみ。認証不要・CORS開放。
 *   portal 自身の画面（tasks / EntryBoard / CandidateDetailPage 等）と
 *   candidate-intake のブラウザから直接叩かれているため、この経路に認証は掛けられない。
 * - `?includeInactive=true`: disabled（退社者等）も含めた全ステータスを返す。
 *   退社者まで匿名公開はしたくないので、こちらだけ x-api-key（INTERNAL_API_KEY）を必須にする。
 */
export async function GET(request: NextRequest) {
  try {
    const includeInactive =
      request.nextUrl.searchParams.get("includeInactive") === "true";

    if (includeInactive && !validateInternalApiKey(request)) {
      return NextResponse.json(
        { error: "Unauthorized: includeInactive には x-api-key が必要です" },
        { status: 401 }
      );
    }

    const employees = await prisma.employee.findMany({
      where: includeInactive ? undefined : { status: "active" },
      orderBy: { employeeNumber: "asc" },
      select: {
        id: true,
        employeeNumber: true,
        name: true,
        status: true,
        userId: true,
      },
    });

    // レスポンス形式を統一（employeeNo として返す）
    const response = employees.map((emp) => ({
      id: emp.id,
      employeeNo: emp.employeeNumber,
      name: emp.name,
      status: emp.status,
      userId: emp.userId,
    }));

    return NextResponse.json(response, { headers: CORS_HEADERS });
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
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}

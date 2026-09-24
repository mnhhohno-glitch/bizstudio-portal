import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { validateInternalApiKey } from "@/lib/internal-auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
} as const;

/**
 * GET /api/employees
 * 有効な社員一覧を返す
 *
 * - 既定（パラメータなし）: status="active" のみ。
 *   T-191 で session 必須化（candidate-intake 旧画面は廃止）。呼び出し元は portal 自身の画面
 *   （tasks / EntryBoard / CandidateDetailPage 等）のみなので、ログイン必須で問題ない。
 *   CORS ヘッダは残すが credentials を伴わない `*` なので、認証後は情報が漏れない。
 * - `?includeInactive=true`: disabled（退社者等）も含めた全ステータスを返す。
 *   こちらは従来どおり x-api-key（INTERNAL_API_KEY）で認証する（サーバー間連携用）。
 */
export async function GET(request: NextRequest) {
  try {
    const includeInactive =
      request.nextUrl.searchParams.get("includeInactive") === "true";

    if (includeInactive) {
      if (!validateInternalApiKey(request)) {
        return NextResponse.json(
          { error: "Unauthorized: includeInactive には x-api-key が必要です" },
          { status: 401 }
        );
      }
    } else {
      const user = await getSessionUser();
      if (!user) {
        return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
      }
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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /api/candidates
 * 求職者一覧を返す
 *
 * T-191 で session 必須化（candidate-intake 旧画面は廃止）。
 * CORS ヘッダは残すが credentials を伴わない `*` なので、認証後は情報が漏れない。
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const candidates = await prisma.candidate.findMany({
      orderBy: { candidateNumber: "desc" },
      select: {
        id: true,
        candidateNumber: true,
        name: true,
        employee: {
          select: {
            name: true,
          },
        },
      },
    });

    // レスポンス形式を統一（candidateNo, careerAdvisor として返す）
    const response = candidates.map((c) => ({
      id: c.id,
      candidateNo: c.candidateNumber,
      name: c.name,
      careerAdvisor: c.employee?.name || null,
    }));

    return NextResponse.json(response, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
      },
    });
  } catch (error) {
    console.error("Failed to fetch candidates:", error);
    return NextResponse.json(
      { error: "求職者一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/candidates
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  const link = await prisma.scheduleLink.findUnique({
    where: { token },
  });

  if (!link) {
    return NextResponse.json(
      { error: "リンクが見つかりません" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      candidateName: link.candidateName,
      advisorName: link.advisorName,
      interviewMethod: link.interviewMethod,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

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

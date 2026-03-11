import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const session = await prisma.jimuSession.findUnique({
      where: { token },
    });

    if (!session) {
      return NextResponse.json(
        { error: "セッションが見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      state: session.state,
      candidateName: session.candidateName,
    });
  } catch {
    return NextResponse.json(
      { error: "データの取得に失敗しました" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json();

    const session = await prisma.jimuSession.findUnique({
      where: { token },
    });

    if (!session) {
      return NextResponse.json(
        { error: "セッションが見つかりません" },
        { status: 404 }
      );
    }

    const updated = await prisma.jimuSession.update({
      where: { token },
      data: {
        state: body.state as Prisma.InputJsonValue,
        candidateName: body.candidateName ?? session.candidateName,
      },
    });

    return NextResponse.json({ state: updated.state });
  } catch {
    return NextResponse.json(
      { error: "データの保存に失敗しました" },
      { status: 500 }
    );
  }
}

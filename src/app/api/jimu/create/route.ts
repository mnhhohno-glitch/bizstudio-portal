import { NextResponse } from "next/server";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { initialAppState } from "@/types/jimu";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const candidateName = body.candidateName || null;

    const token = crypto.randomBytes(16).toString("hex");

    const session = await prisma.jimuSession.create({
      data: {
        token,
        candidateName,
        state: initialAppState as unknown as Prisma.InputJsonValue,
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const url = `${appUrl}/j/${session.token}`;

    return NextResponse.json({ token: session.token, url });
  } catch {
    return NextResponse.json(
      { error: "セッションの作成に失敗しました" },
      { status: 500 }
    );
  }
}

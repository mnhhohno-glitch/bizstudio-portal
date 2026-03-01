import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { generateToken, hashToken } from "@/lib/encryption";

const APP_URL_ENV_MAP: Record<string, string | undefined> = {
  material_creator: process.env.NEXT_PUBLIC_MATERIAL_CREATOR_URL,
  job_analyzer: process.env.NEXT_PUBLIC_JOB_ANALYZER_URL,
  candidate_intake: process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL,
};

const APP_ID_REGISTRY: Record<string, boolean> = {
  material_creator: true,
};

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    if (user.status !== "active") {
      return NextResponse.json({ error: "アカウントが無効です" }, { status: 403 });
    }

    const body = await request.json();
    const { target_app } = body;

    if (!target_app || !APP_ID_REGISTRY[target_app]) {
      return NextResponse.json({ error: "無効なtarget_appです" }, { status: 400 });
    }

    const systemLink = await prisma.systemLink.findFirst({
      where: { appId: target_app, status: "active" },
    });

    if (!systemLink) {
      return NextResponse.json({ error: "対象アプリが見つかりません" }, { status: 400 });
    }

    const token = generateToken("oat_");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.appToken.create({
      data: {
        userId: user.id,
        tokenHash,
        targetApp: target_app,
        expiresAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "ISSUE_APP_TOKEN",
        targetType: "AUTH",
        metadata: { targetApp: target_app, expiresAt: expiresAt.toISOString() },
      },
    });

    const targetUrl = APP_URL_ENV_MAP[target_app] || systemLink.url;

    return NextResponse.json({
      token,
      expires_at: expiresAt.toISOString(),
      target_url: targetUrl,
    });
  } catch (error) {
    console.error("Failed to issue app token:", error);
    return NextResponse.json({ error: "トークン発行に失敗しました" }, { status: 500 });
  }
}

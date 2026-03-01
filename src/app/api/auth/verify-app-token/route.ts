import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/encryption";
import { handleCorsOptions, withCors } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsOptions(request);
  return response || new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const body = await request.json();
    const { token, app_id } = body;

    if (!token || !app_id) {
      return withCors(
        NextResponse.json({ valid: false, error: "token_invalid" }, { status: 401 }),
        origin
      );
    }

    const tokenHash = hashToken(token);

    const appToken = await prisma.appToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!appToken) {
      await logVerification(null, app_id, false, "token_invalid");
      return withCors(
        NextResponse.json({ valid: false, error: "token_invalid" }, { status: 401 }),
        origin
      );
    }

    if (appToken.usedAt) {
      await logVerification(appToken.userId, app_id, false, "token_used");
      return withCors(
        NextResponse.json({ valid: false, error: "token_used" }, { status: 401 }),
        origin
      );
    }

    if (appToken.expiresAt < new Date()) {
      await logVerification(appToken.userId, app_id, false, "token_expired");
      return withCors(
        NextResponse.json({ valid: false, error: "token_expired" }, { status: 401 }),
        origin
      );
    }

    if (appToken.targetApp !== app_id) {
      await logVerification(appToken.userId, app_id, false, "app_mismatch");
      return withCors(
        NextResponse.json({ valid: false, error: "app_mismatch" }, { status: 401 }),
        origin
      );
    }

    await prisma.appToken.update({
      where: { id: appToken.id },
      data: { usedAt: new Date() },
    });

    const sessionToken = generateToken("ast_");
    const sessionTokenHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    await prisma.appSession.create({
      data: {
        userId: appToken.userId,
        sessionTokenHash,
        appId: app_id,
        expiresAt: sessionExpiresAt,
      },
    });

    await logVerification(appToken.userId, app_id, true);

    return withCors(
      NextResponse.json({
        valid: true,
        user: {
          id: appToken.user.id,
          name: appToken.user.name,
          email: appToken.user.email,
          role: appToken.user.role,
        },
        session_token: sessionToken,
        session_expires_at: sessionExpiresAt.toISOString(),
      }),
      origin
    );
  } catch (error) {
    console.error("Failed to verify app token:", error);
    return withCors(
      NextResponse.json({ valid: false, error: "internal_error" }, { status: 500 }),
      origin
    );
  }
}

async function logVerification(userId: string | null, appId: string, success: boolean, error?: string) {
  if (!userId) return;
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: "VERIFY_APP_TOKEN",
        targetType: "AUTH",
        metadata: { appId, success, ...(error && { error }) },
      },
    });
  } catch {
    console.error("Failed to create audit log");
  }
}

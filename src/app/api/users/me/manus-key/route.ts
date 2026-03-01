import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { encrypt, decrypt, hashToken } from "@/lib/encryption";
import { handleCorsOptions, withCors } from "@/lib/cors";

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const sessionToken = authHeader.substring(7);
    const sessionTokenHash = hashToken(sessionToken);
    const session = await prisma.appSession.findFirst({
      where: { sessionTokenHash },
      include: { user: true },
    });
    if (session && session.expiresAt > new Date()) {
      return session.user;
    }
  }
  return await getSessionUser();
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsOptions(request);
  return response || new NextResponse(null, { status: 204 });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return withCors(
        NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
        origin
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { manusApiKeyEncrypted: true },
    });

    if (!dbUser?.manusApiKeyEncrypted) {
      return withCors(
        NextResponse.json({ has_key: false, manus_api_key: null }),
        origin
      );
    }

    try {
      const decrypted = decrypt(dbUser.manusApiKeyEncrypted);
      return withCors(
        NextResponse.json({ has_key: true, manus_api_key: decrypted }),
        origin
      );
    } catch {
      return withCors(
        NextResponse.json({ has_key: false, manus_api_key: null, error: "復号に失敗しました" }),
        origin
      );
    }
  } catch (error) {
    console.error("Failed to get Manus API key:", error);
    return withCors(
      NextResponse.json({ error: "取得に失敗しました" }, { status: 500 }),
      origin
    );
  }
}

export async function PATCH(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return withCors(
        NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
        origin
      );
    }

    const body = await request.json();
    const { manus_api_key } = body;

    if (!manus_api_key || typeof manus_api_key !== "string" || manus_api_key.length === 0) {
      return withCors(
        NextResponse.json({ error: "APIキーを入力してください" }, { status: 400 }),
        origin
      );
    }

    if (manus_api_key.length > 200) {
      return withCors(
        NextResponse.json({ error: "APIキーが長すぎます" }, { status: 400 }),
        origin
      );
    }

    const encrypted = encrypt(manus_api_key);
    const now = new Date();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        manusApiKeyEncrypted: encrypted,
        manusApiKeySetAt: now,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "UPDATE_MANUS_KEY",
        targetType: "USER",
        metadata: { userId: user.id },
      },
    });

    return withCors(
      NextResponse.json({ success: true, set_at: now.toISOString() }),
      origin
    );
  } catch (error) {
    console.error("Failed to update Manus API key:", error);
    return withCors(
      NextResponse.json({ error: "更新に失敗しました" }, { status: 500 }),
      origin
    );
  }
}

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return withCors(
        NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
        origin
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        manusApiKeyEncrypted: null,
        manusApiKeySetAt: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "DELETE_MANUS_KEY",
        targetType: "USER",
        metadata: { userId: user.id },
      },
    });

    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error) {
    console.error("Failed to delete Manus API key:", error);
    return withCors(
      NextResponse.json({ error: "削除に失敗しました" }, { status: 500 }),
      origin
    );
  }
}

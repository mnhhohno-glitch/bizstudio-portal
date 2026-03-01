import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { decrypt, hashToken } from "@/lib/encryption";
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
      select: { manusApiKeyEncrypted: true, manusApiKeySetAt: true },
    });

    if (!dbUser?.manusApiKeyEncrypted) {
      return withCors(
        NextResponse.json({ has_key: false, manus_api_key: null, last4: null, set_at: null }),
        origin
      );
    }

    try {
      const decrypted = decrypt(dbUser.manusApiKeyEncrypted);
      return withCors(
        NextResponse.json({
          has_key: true,
          manus_api_key: decrypted,
          last4: decrypted.slice(-4),
          set_at: dbUser.manusApiKeySetAt?.toISOString() ?? null,
        }),
        origin
      );
    } catch {
      return withCors(
        NextResponse.json({ has_key: false, manus_api_key: null, last4: null, set_at: null, error: "復号に失敗しました" }),
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

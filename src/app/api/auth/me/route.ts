import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/encryption";
import { handleCorsOptions, withCors } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsOptions(request);
  return response || new NextResponse(null, { status: 204 });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return withCors(
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
        origin
      );
    }

    const sessionToken = authHeader.substring(7);
    const sessionTokenHash = hashToken(sessionToken);

    const session = await prisma.appSession.findFirst({
      where: { sessionTokenHash },
      include: { user: true },
    });

    if (!session) {
      return withCors(
        NextResponse.json({ error: "session_invalid" }, { status: 401 }),
        origin
      );
    }

    if (session.expiresAt < new Date()) {
      return withCors(
        NextResponse.json({ error: "session_expired" }, { status: 401 }),
        origin
      );
    }

    return withCors(
      NextResponse.json({
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      }),
      origin
    );
  } catch (error) {
    console.error("Failed to get user info:", error);
    return withCors(
      NextResponse.json({ error: "internal_error" }, { status: 500 }),
      origin
    );
  }
}

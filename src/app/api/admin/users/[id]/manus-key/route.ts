import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/encryption";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      manusApiKeyEncrypted: true,
      manusApiKeySetAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  }

  if (!user.manusApiKeyEncrypted) {
    return NextResponse.json({
      has_key: false,
      last4: null,
      set_at: null,
    });
  }

  try {
    const decrypted = decrypt(user.manusApiKeyEncrypted);
    return NextResponse.json({
      has_key: true,
      last4: decrypted.slice(-4),
      set_at: user.manusApiKeySetAt?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({
      has_key: true,
      last4: "****",
      set_at: user.manusApiKeySetAt?.toISOString() ?? null,
    });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { manus_api_key } = body;

  if (!manus_api_key || typeof manus_api_key !== "string" || manus_api_key.length === 0) {
    return NextResponse.json({ error: "APIキーを入力してください" }, { status: 400 });
  }

  if (manus_api_key.length > 200) {
    return NextResponse.json({ error: "APIキーが長すぎます" }, { status: 400 });
  }

  const encrypted = encrypt(manus_api_key);
  const now = new Date();

  await prisma.user.update({
    where: { id },
    data: {
      manusApiKeyEncrypted: encrypted,
      manusApiKeySetAt: now,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "ADMIN_SET_MANUS_KEY",
      targetType: "USER",
      targetId: id,
      metadata: { adminUserId: actor.id, targetUserId: id },
    },
  });

  return NextResponse.json({ success: true, set_at: now.toISOString() });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id },
    data: {
      manusApiKeyEncrypted: null,
      manusApiKeySetAt: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "ADMIN_DELETE_MANUS_KEY",
      targetType: "USER",
      targetId: id,
      metadata: { adminUserId: actor.id, targetUserId: id },
    },
  });

  return NextResponse.json({ success: true });
}

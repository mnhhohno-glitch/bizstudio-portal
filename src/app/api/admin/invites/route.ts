import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function POST(req: Request) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  
  const email = body?.email;
  const name = body?.name;
  
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "メールアドレスが不正です" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || name.length < 1) {
    return NextResponse.json({ error: "名前が不正です" }, { status: 400 });
  }

  // 既にユーザーがいるなら招待不要
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "既にユーザーが存在します" },
      { status: 400 }
    );
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await prisma.invite.create({
    data: {
      email,
      tokenHash,
      expiresAt,
      createdByUserId: actor.id,
    },
  });

  await writeAudit({
    actorUserId: actor.id,
    action: "INVITE_CREATED",
    targetType: "USER",
    targetId: invite.id,
    metadata: { email },
  });

  const inviteUrl = `/invite/${rawToken}?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;
  return NextResponse.json({ ok: true, inviteUrl });
}

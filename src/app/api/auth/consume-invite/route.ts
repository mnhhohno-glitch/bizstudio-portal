import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  
  const token = body?.token;
  const email = body?.email;
  const name = body?.name;
  const password = body?.password;
  
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "トークンが不正です" }, { status: 400 });
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "メールアドレスが不正です" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || name.length < 1) {
    return NextResponse.json({ error: "名前が不正です" }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上必要です" }, { status: 400 });
  }

  const tokenHash = sha256(token);

  const invite = await prisma.invite.findFirst({
    where: {
      email,
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!invite) {
    await writeAudit({
      actorUserId: null,
      action: "INVITE_CONSUME_FAILED",
      targetType: "USER",
      metadata: { email },
    });
    return NextResponse.json(
      { error: "招待が無効です（期限切れ/使用済み/不一致）" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "既にユーザーが存在します" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: "member",
      status: "active",
    },
  });

  await prisma.invite.update({
    where: { id: invite.id },
    data: { usedAt: new Date() },
  });

  await writeAudit({
    actorUserId: user.id,
    action: "INVITE_CONSUMED_USER_CREATED",
    targetType: "USER",
    targetId: user.id,
    metadata: { email },
  });

  return NextResponse.json({ ok: true });
}

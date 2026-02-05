import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setSessionUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  
  const email = body?.email;
  const password = body?.password;
  
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "メールアドレスが不正です" }, { status: 400 });
  }
  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "パスワードが不正です" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // ログイン失敗も監査ログに残す（ただし存在有無は返さない）
  if (!user || user.status !== "active") {
    await writeAudit({
      actorUserId: null,
      action: "LOGIN_FAILED",
      targetType: "AUTH",
      metadata: { email },
    });
    return NextResponse.json(
      { error: "メールまたはパスワードが違います" },
      { status: 401 }
    );
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await writeAudit({
      actorUserId: null,
      action: "LOGIN_FAILED",
      targetType: "AUTH",
      targetId: user.id,
      metadata: { email },
    });
    return NextResponse.json(
      { error: "メールまたはパスワードが違います" },
      { status: 401 }
    );
  }

  await setSessionUserId(user.id);

  await writeAudit({
    actorUserId: user.id,
    action: "LOGIN_SUCCESS",
    targetType: "AUTH",
    targetId: user.id,
    metadata: { email },
  });

  return NextResponse.json({ ok: true });
}

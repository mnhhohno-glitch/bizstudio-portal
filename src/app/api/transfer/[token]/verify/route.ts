// T-147: パスワード照合（認証不要・社外の受信者が叩く）。
// - 成功: 有効期間2時間のJWTを httpOnly Cookie に発行し、ファイル一覧を返す
// - 失敗: failedAttempts を加算し、約1秒遅延させてから 401（総当たり対策・確定仕様）
//   10回に達した時点で自動無効化し、送信者へメール通知する
// - 存在しない / 期限切れ / 無効化済み はすべて同じ 404 { error: "unavailable" }
//   （トークンの存在有無・状態を外部に漏らさない）

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import {
  isTransferAvailable,
  issueTransferAccessToken,
  transferAccessCookieName,
  FAILED_ATTEMPTS_LIMIT,
} from "@/lib/secure-transfer";
import { sendTransferLockedEmail } from "@/lib/secure-transfer-mail";

export const runtime = "nodejs";

const FAIL_DELAY_MS = 1000;

const unavailable = () =>
  NextResponse.json({ error: "unavailable" }, { status: 404 });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const password = body?.password ?? "";

  if (!password) {
    return NextResponse.json(
      { error: "パスワードを入力してください" },
      { status: 400 }
    );
  }

  const transfer = await prisma.secureTransfer.findUnique({
    where: { token },
    include: {
      sender: { select: { name: true, email: true } },
      files: {
        where: { deletedAt: null },
        select: { id: true, fileName: true, fileSize: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!transfer || !isTransferAvailable(transfer)) {
    return unavailable();
  }

  const valid = await compare(password, transfer.passwordHash);

  if (!valid) {
    const updated = await prisma.secureTransfer.update({
      where: { id: transfer.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true, revokedAt: true },
    });

    if (updated.failedAttempts >= FAILED_ATTEMPTS_LIMIT && !updated.revokedAt) {
      // 自動無効化。通知メールの失敗は無効化自体を妨げない（fail-open）
      await prisma.secureTransfer.update({
        where: { id: transfer.id },
        data: { revokedAt: new Date() },
      });
      console.warn(
        `[T-147] transfer auto-revoked after ${updated.failedAttempts} failed attempts: id=${transfer.id}`
      );
      await sendTransferLockedEmail({
        to: transfer.sender.email,
        senderName: transfer.sender.name,
        recipientEmail: transfer.recipientEmail,
        subject: transfer.subject,
        createdAt: transfer.createdAt,
      });
    }

    // 総当たり対策の遅延（確定仕様: 1秒程度）
    await new Promise((resolve) => setTimeout(resolve, FAIL_DELAY_MS));

    if (updated.failedAttempts >= FAILED_ATTEMPTS_LIMIT) {
      // ロック後は状態を悟らせない（以降のアクセスと同じ応答）
      return unavailable();
    }
    return NextResponse.json(
      { error: "パスワードが正しくありません" },
      { status: 401 }
    );
  }

  const { jwt: accessToken, maxAge } = issueTransferAccessToken(token);

  const response = NextResponse.json({
    files: transfer.files,
    expiresAt: transfer.expiresAt,
  });
  response.cookies.set(transferAccessCookieName(token), accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return response;
}

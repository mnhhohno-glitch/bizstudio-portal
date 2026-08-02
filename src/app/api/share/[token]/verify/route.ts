import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import jwt from "jsonwebtoken";

// T-147 ついで対応: フォールバック文字列を削除（既知文字列でJWTを偽造できてしまうため）。
// PORTAL_SSO_SECRET 未設定は fail-closed（本番・staging とも設定済みを確認済み）。
function getShareSecret(): string {
  const secret = process.env.PORTAL_SSO_SECRET;
  if (!secret) throw new Error("PORTAL_SSO_SECRET is not set");
  return secret;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { password } = (await req.json()) as { password: string };

  if (!password) {
    return NextResponse.json({ error: "パスワードを入力してください" }, { status: 400 });
  }

  const link = await prisma.fileShareLink.findUnique({
    where: { token },
  });

  if (!link || !link.isActive) {
    return NextResponse.json({ error: "このリンクは無効です" }, { status: 404 });
  }

  if (new Date() > link.expiresAt) {
    return NextResponse.json({ error: "このリンクの有効期限が切れています" }, { status: 410 });
  }

  const valid = await compare(password, link.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "パスワードが正しくありません" }, { status: 401 });
  }

  // Issue a short-lived JWT for download access
  const accessToken = jwt.sign(
    { shareToken: token, fileIds: link.fileIds },
    getShareSecret(),
    { expiresIn: "2h" }
  );

  // Get file details
  const fileIdList = link.fileIds.split(",");
  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIdList } },
    select: { id: true, fileName: true, fileSize: true, mimeType: true },
  });

  const response = NextResponse.json({ files });
  response.cookies.set(`share_${token}`, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/`,
    maxAge: 60 * 60 * 2, // 2 hours
  });

  return response;
}

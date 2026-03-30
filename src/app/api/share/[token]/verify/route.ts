import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import jwt from "jsonwebtoken";

const SHARE_SECRET = process.env.PORTAL_SSO_SECRET || "bizstudio-sso-shared-secret-key";

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
    SHARE_SECRET,
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

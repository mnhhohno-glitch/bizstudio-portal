import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hash } from "bcryptjs";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { fileIds } = (await req.json()) as { fileIds: string[] };

  if (!fileIds?.length) {
    return NextResponse.json({ error: "fileIds is required" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { birthday: true, name: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  if (!candidate.birthday) {
    return NextResponse.json({ error: "生年月日が登録されていません。基本情報から登録してください。" }, { status: 400 });
  }

  // Verify files exist and are BS_DOCUMENT
  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, candidateId, category: "BS_DOCUMENT" },
    select: { id: true, fileName: true },
  });

  if (files.length === 0) {
    return NextResponse.json({ error: "対象ファイルが見つかりません" }, { status: 400 });
  }

  // Format birthday as YYYYMMDD
  const bd = candidate.birthday;
  const birthdayStr = `${bd.getFullYear()}${String(bd.getMonth() + 1).padStart(2, "0")}${String(bd.getDate()).padStart(2, "0")}`;
  const passwordHash = await hash(birthdayStr, 10);

  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14);

  await prisma.fileShareLink.create({
    data: {
      token,
      candidateId,
      fileIds: files.map((f) => f.id).join(","),
      passwordHash,
      expiresAt,
      createdBy: user.id,
    },
  });

  const baseUrl = process.env.PORTAL_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";

  return NextResponse.json({
    url: `${baseUrl}/share/${token}`,
    token,
    expiresAt: expiresAt.toISOString(),
    fileCount: files.length,
    files: files.map((f) => f.fileName),
    passwordHint: "生年月日8桁（例: 19980315）",
  });
}

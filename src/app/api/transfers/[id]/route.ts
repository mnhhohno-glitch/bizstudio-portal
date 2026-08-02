// T-147: セキュアファイル送信 詳細API（ダウンロード履歴つき）。
// 全社員が閲覧可（社内の証跡目的・確定仕様）。middleware は /api/ を素通しするため認証はここで行う。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getTransferStatus } from "@/lib/secure-transfer";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const transfer = await prisma.secureTransfer.findUnique({
    where: { id },
    include: {
      sender: { select: { id: true, name: true } },
      files: {
        select: { id: true, fileName: true, fileSize: true, deletedAt: true },
        orderBy: { createdAt: "asc" },
      },
      downloads: {
        orderBy: { downloadedAt: "desc" },
        take: 200,
        include: { file: { select: { fileName: true } } },
      },
    },
  });

  if (!transfer) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: transfer.id,
    recipientEmail: transfer.recipientEmail,
    subject: transfer.subject,
    message: transfer.message,
    expiresAt: transfer.expiresAt,
    revokedAt: transfer.revokedAt,
    failedAttempts: transfer.failedAttempts,
    passwordInEmail: transfer.passwordInEmail,
    createdAt: transfer.createdAt,
    status: getTransferStatus(transfer),
    sender: transfer.sender,
    files: transfer.files,
    downloads: transfer.downloads.map((d) => ({
      id: d.id,
      fileName: d.file?.fileName ?? null,
      downloadedAt: d.downloadedAt,
      ipAddress: d.ipAddress,
      userAgent: d.userAgent,
    })),
    canRevoke:
      !transfer.revokedAt &&
      (transfer.senderId === user.id || user.role === "admin"),
  });
}

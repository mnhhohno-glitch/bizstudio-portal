// T-147: セキュアファイル送信 作成・一覧API。
// - GET  : 全社員の送信を閲覧可（社内の証跡目的・確定仕様）
// - POST : パスワード自動生成 → レコード作成 → 案内メール送信。
//          メール送信に失敗したらレコードとStorage実体を消して失敗を返す（不完全なレコードを残さない）。
// middleware は /api/ を素通しするため、認証はこのルートで行う（漏れ禁止）。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { hash } from "bcryptjs";
import {
  SECURE_TRANSFER_BUCKET,
  MAX_TRANSFER_FILES,
  MAX_TRANSFER_FILE_SIZE,
  generateTransferToken,
  generateTransferPassword,
  calcExpiresAt,
  getTransferStatus,
} from "@/lib/secure-transfer";
import { buildTransferUrl, sendTransferNoticeEmail } from "@/lib/secure-transfer-mail";

export const runtime = "nodejs";
export const maxDuration = 60;

// upload-url が発行するパス以外を受け付けない（他オブジェクトの参照・パストラバーサル防止）
const STORAGE_PATH_RE =
  /^transfers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const transfers = await prisma.secureTransfer.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true } },
      files: {
        select: { id: true, fileName: true, fileSize: true, deletedAt: true },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { downloads: true } },
    },
  });

  return NextResponse.json({
    transfers: transfers.map((t) => ({
      id: t.id,
      recipientEmail: t.recipientEmail,
      subject: t.subject,
      expiresAt: t.expiresAt,
      revokedAt: t.revokedAt,
      failedAttempts: t.failedAttempts,
      createdAt: t.createdAt,
      status: getTransferStatus(t),
      filesDeleted: t.files.length > 0 && t.files.every((f) => f.deletedAt !== null),
      sender: t.sender,
      files: t.files,
      downloadCount: t._count.downloads,
      canRevoke:
        !t.revokedAt && (t.senderId === user.id || user.role === "admin"),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    recipientEmail?: string;
    subject?: string;
    message?: string;
    expiresDays?: number;
    files?: { fileName?: string; fileSize?: number; storagePath?: string }[];
  } | null;

  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const recipientEmail = body.recipientEmail?.trim() ?? "";
  if (!EMAIL_RE.test(recipientEmail)) {
    return NextResponse.json(
      { error: "宛先メールアドレスの形式が正しくありません" },
      { status: 400 }
    );
  }

  const expiresDays = body.expiresDays ?? 7;
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 30) {
    return NextResponse.json(
      { error: "有効期限は1〜30日で指定してください" },
      { status: 400 }
    );
  }

  const files = body.files ?? [];
  if (files.length === 0) {
    return NextResponse.json({ error: "ファイルが必要です" }, { status: 400 });
  }
  if (files.length > MAX_TRANSFER_FILES) {
    return NextResponse.json(
      { error: `ファイルは最大${MAX_TRANSFER_FILES}件までです` },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const validated: { fileName: string; fileSize: number; storagePath: string }[] = [];

  for (const f of files) {
    const fileName = f.fileName?.trim();
    const storagePath = f.storagePath ?? "";
    if (!fileName || !STORAGE_PATH_RE.test(storagePath)) {
      return NextResponse.json({ error: "ファイル情報が不正です" }, { status: 400 });
    }

    // upload-url 発行分でも、他の送信で既に使われているパスは拒否（DBの unique と二重ガード）
    const dup = await prisma.secureTransferFile.findUnique({
      where: { storagePath },
      select: { id: true },
    });
    if (dup) {
      return NextResponse.json({ error: "ファイル情報が不正です" }, { status: 400 });
    }

    // Storage 上に実体があるか確認し、サイズは Storage 側の実測値を採用する（クライアント申告を信用しない）
    const baseName = storagePath.slice("transfers/".length);
    const { data: listed, error: listError } = await supabase.storage
      .from(SECURE_TRANSFER_BUCKET)
      .list("transfers", { search: baseName.split(".")[0], limit: 5 });
    if (listError) {
      console.error("[T-147] storage list failed:", listError);
      return NextResponse.json(
        { error: "アップロード済みファイルの確認に失敗しました" },
        { status: 500 }
      );
    }
    const obj = (listed ?? []).find((o) => o.name === baseName);
    if (!obj) {
      return NextResponse.json(
        { error: `アップロードが完了していないファイルがあります: ${fileName}` },
        { status: 400 }
      );
    }
    const meta = obj.metadata as { size?: number } | null;
    const actualSize =
      typeof meta?.size === "number" ? meta.size : (f.fileSize ?? 0);
    if (actualSize <= 0 || actualSize > MAX_TRANSFER_FILE_SIZE) {
      return NextResponse.json(
        { error: `ファイルサイズが不正です: ${fileName}` },
        { status: 400 }
      );
    }

    validated.push({ fileName, fileSize: actualSize, storagePath });
  }

  // パスワード・トークン生成（平文パスワードはこのリクエスト内でのみ保持。ログに出さない）
  const password = generateTransferPassword();
  const passwordHash = await hash(password, 10);
  const token = generateTransferToken();
  const expiresAt = calcExpiresAt(expiresDays);

  const transfer = await prisma.secureTransfer.create({
    data: {
      token,
      senderId: user.id,
      recipientEmail,
      subject: body.subject?.trim() || null,
      message: body.message?.trim() || null,
      passwordHash,
      expiresAt,
      files: { create: validated },
    },
    include: { files: true },
  });

  const url = buildTransferUrl(token);
  const mailResult = await sendTransferNoticeEmail({
    to: recipientEmail,
    senderName: user.name ?? user.email,
    url,
    password,
    expiresAt,
    fileNames: validated.map((f) => f.fileName),
    subject: transfer.subject,
    message: transfer.message,
  });

  if (!mailResult.ok) {
    // 不完全なレコードを残さない（確定仕様）。Storage 実体も掃除して再アップロードからやり直してもらう。
    await prisma.secureTransfer
      .delete({ where: { id: transfer.id } })
      .catch((e) => console.error("[T-147] rollback delete failed:", e));
    await supabase.storage
      .from(SECURE_TRANSFER_BUCKET)
      .remove(validated.map((f) => f.storagePath))
      .catch((e) => console.error("[T-147] rollback storage remove failed:", e));
    return NextResponse.json({ error: mailResult.error }, { status: 502 });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "SECURE_TRANSFER_CREATE",
      // AuditTargetType は既存 DB enum のため値を足さない（共有DBの既存型変更を避ける）。
      // 判別は action 文字列で行う。
      targetType: "SYSTEM",
      targetId: transfer.id,
      metadata: {
        recipientEmail,
        fileNames: validated.map((f) => f.fileName),
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  // パスワードはこのレスポンスの一度きり（再表示不可・DBに平文なし）
  return NextResponse.json(
    {
      id: transfer.id,
      url,
      password,
      expiresAt,
      recipientEmail,
      files: validated.map((f) => ({ fileName: f.fileName, fileSize: f.fileSize })),
    },
    { status: 201 }
  );
}

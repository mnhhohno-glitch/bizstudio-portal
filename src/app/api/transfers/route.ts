// T-147: セキュアファイル送信 作成・一覧API。
// - GET  : 全社員の送信を閲覧可（社内の証跡目的・確定仕様）
// - POST : 複数宛先対応。宛先ごとに secure_transfers レコード・URL・パスワードを個別発行し、
//          同一操作の束ねとして batch_id を共有する（誰がDLしたか追跡・宛先単位の無効化のため）。
//          メールも宛先ごとに個別送信（BCC・一括送信はしない・確定仕様）。
//          Storage 実体も宛先ごとに独立させる（copy）。共有すると1宛先の無効化→cleanup削除で
//          他宛先のファイルまで消えるため。
// - 失敗時の方針: 宛先単位でメール送信に失敗したらその宛先のレコードだけ取り消して続行。
//   全宛先失敗（またはStorageコピー失敗）は全て巻き戻して 502 を返し、
//   クライアント側は再アップロードからやり直す（不完全なレコードを残さない・従来と同じ）。
// middleware は /api/ を素通しするため、認証はこのルートで行う（漏れ禁止）。

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
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
import { MAX_TRANSFER_RECIPIENTS } from "@/lib/secure-transfer-shared";
import { buildTransferUrl, sendTransferNoticeEmail } from "@/lib/secure-transfer-mail";

export const runtime = "nodejs";
export const maxDuration = 120; // 宛先数×（bcrypt + Storageコピー + メール送信）のため60秒から延長

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
      passwordInEmail: t.passwordInEmail,
      batchId: t.batchId,
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
    recipientEmails?: string[];
    subject?: string;
    message?: string;
    expiresDays?: number;
    passwordInEmail?: boolean;
    files?: { fileName?: string; fileSize?: number; storagePath?: string }[];
  } | null;

  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const recipientEmails = (body.recipientEmails ?? [])
    .map((e) => (typeof e === "string" ? e.trim() : ""))
    .filter((e) => e.length > 0);
  if (recipientEmails.length === 0) {
    return NextResponse.json(
      { error: "宛先メールアドレスを入力してください" },
      { status: 400 }
    );
  }
  if (recipientEmails.length > MAX_TRANSFER_RECIPIENTS) {
    return NextResponse.json(
      { error: `宛先は最大${MAX_TRANSFER_RECIPIENTS}件までです` },
      { status: 400 }
    );
  }
  for (const email of recipientEmails) {
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: `宛先メールアドレスの形式が正しくありません: ${email}` },
        { status: 400 }
      );
    }
  }

  const expiresDays = body.expiresDays ?? 30;
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 30) {
    return NextResponse.json(
      { error: "有効期限は1〜30日で指定してください" },
      { status: 400 }
    );
  }

  // 未指定は従来どおり「メールに記載する」
  const passwordInEmail = body.passwordInEmail !== false;

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

  const batchId = randomUUID();
  const expiresAt = calcExpiresAt(expiresDays);

  // 宛先ごとの処理結果。orphanPaths は「レコードに紐付かなくなった Storage パス」で最後にまとめて掃除する
  // （宛先0の実体は後続宛先の copy 元になるため、途中で消してはいけない）。
  const created: { id: string; recipientEmail: string; url: string; password: string }[] = [];
  const failedRecipients: string[] = [];
  const orphanPaths: string[] = [];

  const removePaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    await supabase.storage
      .from(SECURE_TRANSFER_BUCKET)
      .remove(paths)
      .catch((e) => console.error("[T-147] rollback storage remove failed:", e));
  };

  for (let i = 0; i < recipientEmails.length; i++) {
    const recipientEmail = recipientEmails[i];

    // 宛先ごとに Storage 実体を独立させる。先頭の宛先はアップロードされた実体をそのまま使い、
    // 2件目以降は copy で複製する（コピー失敗は全巻き戻し）。
    let recipientFiles: { fileName: string; fileSize: number; storagePath: string }[];
    if (i === 0) {
      recipientFiles = validated;
    } else {
      recipientFiles = [];
      for (const f of validated) {
        const ext = f.storagePath.split(".").pop() ?? "bin";
        const newPath = `transfers/${randomUUID()}.${ext}`;
        const { error: copyError } = await supabase.storage
          .from(SECURE_TRANSFER_BUCKET)
          .copy(f.storagePath, newPath);
        if (copyError) {
          console.error("[T-147] storage copy failed:", copyError);
          // 全巻き戻し: ここまでに作ったレコード・複製・元実体をすべて消して 502
          // （クライアントは再アップロードからやり直す）。
          // パスの取得はレコード削除より先に行う（削除すると cascade で file 行も消えるため）。
          const createdPaths = await prisma.secureTransferFile
            .findMany({ where: { transfer: { batchId } }, select: { storagePath: true } })
            .then((rows) => rows.map((r) => r.storagePath))
            .catch(() => [] as string[]);
          for (const c of created) {
            await prisma.secureTransfer
              .delete({ where: { id: c.id } })
              .catch((e) => console.error("[T-147] rollback delete failed:", e));
          }
          await removePaths([
            ...new Set([
              ...validated.map((f2) => f2.storagePath),
              ...recipientFiles.map((f2) => f2.storagePath),
              ...orphanPaths,
              ...createdPaths,
            ]),
          ]);
          return NextResponse.json(
            { error: "ファイルの複製に失敗しました。もう一度お試しください" },
            { status: 502 }
          );
        }
        recipientFiles.push({ fileName: f.fileName, fileSize: f.fileSize, storagePath: newPath });
      }
    }

    // パスワード・トークン生成（平文パスワードはこのリクエスト内でのみ保持。ログに出さない）
    const password = generateTransferPassword();
    const passwordHash = await hash(password, 10);
    const token = generateTransferToken();

    const transfer = await prisma.secureTransfer.create({
      data: {
        token,
        senderId: user.id,
        recipientEmail,
        subject: body.subject?.trim() || null,
        message: body.message?.trim() || null,
        passwordHash,
        expiresAt,
        passwordInEmail,
        batchId,
        files: { create: recipientFiles },
      },
      select: { id: true, subject: true, message: true },
    });

    const url = buildTransferUrl(token);
    const mailResult = await sendTransferNoticeEmail({
      to: recipientEmail,
      senderName: user.name ?? user.email,
      senderEmail: user.email,
      url,
      password,
      passwordInEmail,
      expiresAt,
      fileNames: recipientFiles.map((f) => f.fileName),
      subject: transfer.subject,
      message: transfer.message,
    });

    if (!mailResult.ok) {
      // この宛先のレコードだけ取り消して続行（Storage 実体の削除は最後にまとめて行う）
      await prisma.secureTransfer
        .delete({ where: { id: transfer.id } })
        .catch((e) => console.error("[T-147] rollback delete failed:", e));
      orphanPaths.push(...recipientFiles.map((f) => f.storagePath));
      failedRecipients.push(recipientEmail);
      continue;
    }

    created.push({ id: transfer.id, recipientEmail, url, password });
  }

  if (created.length === 0) {
    // 全宛先でメール送信に失敗 → 元実体も含めて全て掃除し、再アップロードからやり直してもらう（従来と同じ挙動）
    await removePaths([...new Set(orphanPaths)]);
    return NextResponse.json(
      { error: "メール送信に失敗しました。もう一度お試しください" },
      { status: 502 }
    );
  }

  // 一部の宛先だけ失敗した場合は、その宛先の実体だけ掃除して成功分を返す
  await removePaths([...new Set(orphanPaths)]);

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "SECURE_TRANSFER_CREATE",
      // AuditTargetType は既存 DB enum のため値を足さない（共有DBの既存型変更を避ける）。
      // 判別は action 文字列で行う。
      targetType: "SYSTEM",
      targetId: batchId,
      metadata: {
        batchId,
        recipientEmails: created.map((c) => c.recipientEmail),
        failedRecipients,
        transferIds: created.map((c) => c.id),
        fileNames: validated.map((f) => f.fileName),
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  // パスワードはこのレスポンスの一度きり（再表示不可・DBに平文なし）
  return NextResponse.json(
    {
      batchId,
      passwordInEmail,
      expiresAt,
      files: validated.map((f) => ({ fileName: f.fileName, fileSize: f.fileSize })),
      transfers: created,
      failedRecipients,
    },
    { status: 201 }
  );
}

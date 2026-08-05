// T-147: セキュアファイル送信 作成・一覧API。
// - GET  : 全社員の送信を閲覧可（社内の証跡目的・確定仕様）
// - POST : 2026-08-06 改修で「宛先ごとの個別送信」を廃止し、TO / CC を含む通常のメール1通に変更。
//          1回の送信操作につき secure_transfers レコードは1件だけ作り、
//          URL・パスワードも1組のみ発行して TO・CC の全受信者で共有する。
//          recipient_email に TO をカンマ区切り、cc_emails に CC をカンマ区切りで格納する。
//          batch_id は旧仕様の名残なので新規レコードにはセットしない（過去レコードのため列は残す）。
//          誰がダウンロードしたかは特定できなくなる（ダウンロード履歴は日時・IPのみ・確定仕様）。
// - 失敗時の方針: メール送信に失敗したらレコードごと取り消し Storage も掃除して 502 を返す。
//   クライアント側は再アップロードからやり直す（不完全なレコードを残さない・従来と同じ）。
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
import { MAX_TRANSFER_RECIPIENTS, buildTransferSignature } from "@/lib/secure-transfer-shared";
import { buildTransferUrl, sendTransferNoticeEmail } from "@/lib/secure-transfer-mail";

export const runtime = "nodejs";
export const maxDuration = 120; // bcrypt + Storage 確認 + メール送信のため60秒から延長

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
      recipientEmail: t.recipientEmail, // TO（複数はカンマ区切り。旧レコードは単一アドレス）
      ccEmails: t.ccEmails, // CC（複数はカンマ区切り）。CC 無し・旧レコードは null
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
    recipientEmails?: string[]; // TO（1件以上・必須）
    ccEmails?: string[]; // CC（任意）
    subject?: string; // メール件名（Subject ヘッダ）。空欄は既定文言
    message?: string; // 確認画面で編集された（1）本文の最終形（宛名・挨拶・本題）
    signature?: string; // 確認画面で編集された（4）署名の最終形。空文字=署名なし、未指定=既定署名
    expiresDays?: number;
    passwordInEmail?: boolean;
    files?: { fileName?: string; fileSize?: number; storagePath?: string }[];
  } | null;

  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const normalizeList = (list: unknown): string[] =>
    (Array.isArray(list) ? list : [])
      .map((e) => (typeof e === "string" ? e.trim() : ""))
      .filter((e) => e.length > 0);

  const toEmails = normalizeList(body.recipientEmails);
  const ccEmails = normalizeList(body.ccEmails);

  if (toEmails.length === 0) {
    return NextResponse.json(
      { error: "宛先（TO）のメールアドレスを入力してください" },
      { status: 400 }
    );
  }
  // 上限は TO + CC の合計で判定する（1通のメールに載る受信者の総数）
  if (toEmails.length + ccEmails.length > MAX_TRANSFER_RECIPIENTS) {
    return NextResponse.json(
      { error: `宛先とCCの合計は最大${MAX_TRANSFER_RECIPIENTS}件までです` },
      { status: 400 }
    );
  }
  for (const email of toEmails) {
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: `宛先メールアドレスの形式が正しくありません: ${email}` },
        { status: 400 }
      );
    }
  }
  for (const email of ccEmails) {
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: `CCメールアドレスの形式が正しくありません: ${email}` },
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

  const expiresAt = calcExpiresAt(expiresDays);

  // （1）本文と（4）署名は全受信者で共通（メール自体が1通なので当然共通）。
  // 署名はフィールド未指定（旧クライアント等）なら既定署名、空文字は「署名なし」の明示指定として扱う。
  const bodyText = body.message?.trim() ?? "";
  const signatureText =
    typeof body.signature === "string"
      ? body.signature.trim()
      : buildTransferSignature(user.name ?? user.email, user.email);
  // message 列には署名まで含めた編集内容の最終形を保存する（新規列は追加しない・確定仕様）
  const storedMessage = [bodyText, signatureText].filter(Boolean).join("\n\n") || null;

  const removePaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    await supabase.storage
      .from(SECURE_TRANSFER_BUCKET)
      .remove(paths)
      .catch((e) => console.error("[T-147] rollback storage remove failed:", e));
  };

  // パスワード・トークン生成（平文パスワードはこのリクエスト内でのみ保持。ログに出さない）。
  // 1送信=1組。TO・CC の全受信者が同じ URL とパスワードを使う。
  const password = generateTransferPassword();
  const passwordHash = await hash(password, 10);
  const token = generateTransferToken();

  const transfer = await prisma.secureTransfer.create({
    data: {
      token,
      senderId: user.id,
      recipientEmail: toEmails.join(","),
      ccEmails: ccEmails.length > 0 ? ccEmails.join(",") : null,
      subject: body.subject?.trim() || null,
      message: storedMessage,
      passwordHash,
      expiresAt,
      passwordInEmail,
      // batchId は設定しない（旧仕様の束ねキー。1送信1レコードになったため不要）
      files: { create: validated },
    },
    select: { id: true, subject: true },
  });

  const url = buildTransferUrl(token);
  const mailResult = await sendTransferNoticeEmail({
    to: toEmails,
    cc: ccEmails,
    senderEmail: user.email,
    url,
    password,
    passwordInEmail,
    expiresAt,
    fileNames: validated.map((f) => f.fileName),
    subject: transfer.subject, // 入力値がそのまま Subject ヘッダになる（空は既定文言）
    body: bodyText, // （1）本文。message 列には署名込みの最終形（storedMessage）を保存済み
    signature: signatureText, // （4）署名。空なら署名なしで送る
  });

  if (!mailResult.ok) {
    // 送信できなかったらレコードごと取り消して Storage も掃除し、再アップロードからやり直してもらう
    await prisma.secureTransfer
      .delete({ where: { id: transfer.id } })
      .catch((e) => console.error("[T-147] rollback delete failed:", e));
    await removePaths(validated.map((f) => f.storagePath));
    return NextResponse.json(
      { error: "メール送信に失敗しました。もう一度お試しください" },
      { status: 502 }
    );
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
        transferId: transfer.id,
        recipientEmails: toEmails,
        ccEmails,
        fileNames: validated.map((f) => f.fileName),
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  // パスワードはこのレスポンスの一度きり（再表示不可・DBに平文なし）
  return NextResponse.json(
    {
      id: transfer.id,
      recipientEmails: toEmails,
      ccEmails,
      passwordInEmail,
      expiresAt,
      files: validated.map((f) => ({ fileName: f.fileName, fileSize: f.fileSize })),
      url,
      password,
    },
    { status: 201 }
  );
}

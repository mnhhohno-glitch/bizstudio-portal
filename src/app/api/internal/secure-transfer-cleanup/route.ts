// T-147: 期限切れ・無効化済み送信のファイル実体削除の定期実行エンドポイント。
// GitHub Actions cron（.github/workflows/t147-secure-transfer-cleanup.yml）から
// x-api-key（INTERNAL_API_KEY・auto-expire / resubmit-stale と同一の内部鍵）付きで叩く。
//
// POST /api/internal/secure-transfer-cleanup?dry_run=<true|false>
//   - dry_run=true（既定）は削除せず対象一覧だけ返す。実削除は dry_run=false のときのみ。
//   - 削除対象: expiresAt を過ぎた、または revokedAt がセットされた送信の、deletedAt が
//     まだ立っていないファイル実体（Supabase Storage の secure-transfers バケット）。
//   - Storage のファイルのみ削除し、DBレコードは残す（SecureTransferFile.deletedAt をセット）。
//     送信履歴・ダウンロード履歴は証跡として保持する（確定仕様）。
//   - deletedAt は Storage remove 成功後にのみ立てる（fail-closed: 失敗分は次回に再試行される）。
//
// T-147 改修（期限切れ予告通知）: 同じ実行の中で、明日までに期限が切れる
// 未ダウンロード・未無効化の送信を送信者ごとに1通へまとめて通知する。
//   - 対象: revokedAt=null / expiryNotifiedAt=null / ダウンロード履歴0件 /
//           now < expiresAt <= JST明日23:59:59.999（通常は「期限前日」に該当。
//           前日の実行が失敗・スキップされた場合は当日朝にも拾える window にしている）
//   - expiryNotifiedAt をセットして二重送信を防ぐ（送信成功時のみセット・fail-open で次回再試行）
//   - dry_run=true では送信せず対象一覧のみ返す

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { getSupabase } from "@/lib/supabase";
import { SECURE_TRANSFER_BUCKET, calcExpiresAt } from "@/lib/secure-transfer";
import { sendTransferExpiryNoticeEmail } from "@/lib/secure-transfer-mail";

export const runtime = "nodejs";
export const maxDuration = 120;

const REMOVE_BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRunParam = request.nextUrl.searchParams.get("dry_run");
  // 既定は DRY-RUN（明示的に false を渡したときだけ削除する）
  const dryRun = dryRunParam !== "false";

  const now = new Date();
  const targets = await prisma.secureTransferFile.findMany({
    where: {
      deletedAt: null,
      transfer: {
        OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
      },
    },
    select: {
      id: true,
      storagePath: true,
      fileName: true,
      transfer: {
        select: {
          id: true,
          recipientEmail: true,
          expiresAt: true,
          revokedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const summary = {
    mode: dryRun ? "dry_run" : "execute",
    targetFiles: targets.length,
    targetTransfers: new Set(targets.map((t) => t.transfer.id)).size,
    deleted: 0,
    failed: 0,
    files: targets.map((t) => ({
      fileId: t.id,
      fileName: t.fileName,
      transferId: t.transfer.id,
      recipientEmail: t.transfer.recipientEmail,
      expiresAt: t.transfer.expiresAt,
      revoked: t.transfer.revokedAt !== null,
    })),
  };

  if (!dryRun && targets.length > 0) {
    const supabase = getSupabase();
    for (let i = 0; i < targets.length; i += REMOVE_BATCH_SIZE) {
      const batch = targets.slice(i, i + REMOVE_BATCH_SIZE);
      const paths = batch.map((t) => t.storagePath);
      const { error } = await supabase.storage
        .from(SECURE_TRANSFER_BUCKET)
        .remove(paths);

      if (error) {
        // 失敗分は deletedAt を立てない（次回 cron で再試行）
        console.error("[T-147 cleanup] storage remove failed:", error);
        summary.failed += batch.length;
        continue;
      }

      await prisma.secureTransferFile.updateMany({
        where: { id: { in: batch.map((t) => t.id) } },
        data: { deletedAt: new Date() },
      });
      summary.deleted += batch.length;
    }
  }

  // ---------------------------------------------------------------------------
  // 期限切れ予告通知（T-147 改修）
  // ---------------------------------------------------------------------------
  const noticeTargets = await prisma.secureTransfer.findMany({
    where: {
      revokedAt: null,
      expiryNotifiedAt: null,
      expiresAt: { gt: now, lte: calcExpiresAt(1) }, // 今〜JST明日末に期限が切れるもの
      downloads: { none: {} },
    },
    select: {
      id: true,
      recipientEmail: true,
      ccEmails: true,
      subject: true,
      expiresAt: true,
      sender: { select: { id: true, name: true, email: true } },
    },
    orderBy: { expiresAt: "asc" },
  });

  const notice = {
    targets: noticeTargets.length,
    senders: 0,
    sent: 0, // メール送信できた送信者数
    sendFailed: 0,
    items: noticeTargets.map((t) => ({
      transferId: t.id,
      recipientEmail: t.recipientEmail,
      expiresAt: t.expiresAt,
      senderEmail: t.sender.email,
    })),
  };

  // 送信者ごとに1通へまとめる
  const bySender = new Map<string, typeof noticeTargets>();
  for (const t of noticeTargets) {
    const list = bySender.get(t.sender.id) ?? [];
    list.push(t);
    bySender.set(t.sender.id, list);
  }
  notice.senders = bySender.size;

  if (!dryRun) {
    for (const list of bySender.values()) {
      const sender = list[0].sender;
      const result = await sendTransferExpiryNoticeEmail({
        to: sender.email,
        senderName: sender.name ?? sender.email,
        items: list.map((t) => ({
          recipientEmail: t.recipientEmail,
          ccEmails: t.ccEmails,
          subject: t.subject,
          expiresAt: t.expiresAt,
        })),
      });
      if (!result.ok) {
        // 送信失敗時は expiryNotifiedAt を立てず、次回実行で再試行（window は当日朝まで拾う）
        console.error(
          `[T-147 cleanup] expiry notice mail failed: sender=${sender.id} count=${list.length}`
        );
        notice.sendFailed += 1;
        continue;
      }
      await prisma.secureTransfer.updateMany({
        where: { id: { in: list.map((t) => t.id) } },
        data: { expiryNotifiedAt: new Date() },
      });
      notice.sent += 1;
    }
  }

  console.log(
    `[T-147 cleanup] done: mode=${summary.mode} targets=${summary.targetFiles} deleted=${summary.deleted} failed=${summary.failed} noticeTargets=${notice.targets} noticeSent=${notice.sent}`
  );
  return NextResponse.json({ ...summary, notice });
}

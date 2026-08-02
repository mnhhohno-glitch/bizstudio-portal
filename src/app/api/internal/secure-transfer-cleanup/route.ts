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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { getSupabase } from "@/lib/supabase";
import { SECURE_TRANSFER_BUCKET } from "@/lib/secure-transfer";

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

  if (dryRun || targets.length === 0) {
    return NextResponse.json(summary);
  }

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

  console.log(
    `[T-147 cleanup] done: targets=${summary.targetFiles} deleted=${summary.deleted} failed=${summary.failed}`
  );
  return NextResponse.json(summary);
}

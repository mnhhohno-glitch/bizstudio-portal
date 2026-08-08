// T-147: ファイルダウンロード（認証不要・verify 成功後のJWT Cookie 必須）。
// 有効期間300秒の署名付きURLを発行して 302 リダイレクトする。
// ファイル本体を portal サーバー経由で流さない（Railway 転送量対策・確定仕様）。
// ダウンロードのたびに SecureTransferDownload へ日時・IP・UserAgent を記録する。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";
import {
  SECURE_TRANSFER_BUCKET,
  isTransferAvailable,
  verifyTransferAccessToken,
  transferAccessCookieName,
  getClientIp,
} from "@/lib/secure-transfer";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> }
) {
  const { token, fileId } = await params;

  const accessToken = req.cookies.get(transferAccessCookieName(token))?.value;
  if (!accessToken || !verifyTransferAccessToken(accessToken, token)) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // 照合成功後でも、無効化・期限切れは毎回確認する（無効化の即時反映のため）
  const transfer = await prisma.secureTransfer.findUnique({
    where: { token },
    select: { id: true, expiresAt: true, revokedAt: true },
  });
  if (!transfer || !isTransferAvailable(transfer)) {
    return NextResponse.json({ error: "unavailable" }, { status: 404 });
  }

  const file = await prisma.secureTransferFile.findFirst({
    where: { id: fileId, transferId: transfer.id, deletedAt: null },
    select: { id: true, fileName: true, storagePath: true },
  });
  if (!file) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  const { data, error } = await getSupabase()
    .storage.from(SECURE_TRANSFER_BUCKET)
    .createSignedUrl(file.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: file.fileName, // Content-Disposition に元ファイル名を載せる
    });

  if (error || !data?.signedUrl) {
    console.error("[T-147] createSignedUrl failed:", error);
    return NextResponse.json(
      { error: "ダウンロードURLの発行に失敗しました" },
      { status: 500 }
    );
  }

  // 履歴記録（日時・IP・UserAgent）。記録失敗でダウンロード自体は止めない
  await prisma.secureTransferDownload
    .create({
      data: {
        transferId: transfer.id,
        fileId: file.id,
        ipAddress: getClientIp(req),
        userAgent: req.headers.get("user-agent"),
      },
    })
    .catch((e) => console.error("[T-147] download log failed:", e));

  return NextResponse.redirect(data.signedUrl, 302);
}

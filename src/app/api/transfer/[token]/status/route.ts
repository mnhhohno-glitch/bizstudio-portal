// T-147: 受信側の初期表示用ステータス確認（認証不要）。
// 存在しない / 期限切れ / 無効化済み はすべて同じ { available: false } を返す
// （トークンの存在有無を外部に漏らさない・確定仕様）。ファイル名等の情報は一切返さない。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTransferAvailable } from "@/lib/secure-transfer";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const transfer = await prisma.secureTransfer.findUnique({
    where: { token },
    select: { expiresAt: true, revokedAt: true },
  });

  const available = transfer !== null && isTransferAvailable(transfer);
  return NextResponse.json({ available });
}

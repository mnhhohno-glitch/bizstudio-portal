import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// T-097: 郵便番号→住所候補。ログイン確認のみ。同一番号に複数候補あり得る。
// コードはゼロ詰め7桁（ハイフン除去）に正規化してから検索する。

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { code: raw } = await params;
  const postalCode = raw.replace(/\D/g, "").padStart(7, "0");

  const rows = await prisma.postalCodeMaster.findMany({
    where: { postalCode },
    orderBy: { sortOrder: "asc" },
    select: { address: true },
  });

  return NextResponse.json({ matches: rows.map((r) => ({ address: r.address })) });
}

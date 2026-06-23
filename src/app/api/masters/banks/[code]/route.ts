import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// T-097: 金融機関コード→銀行名。ログイン確認のみ（admin 限定にしない）。
// コードはゼロ詰め4桁に正規化してから検索する。

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { code: raw } = await params;
  const code = raw.replace(/\D/g, "").padStart(4, "0");

  const bank = await prisma.bankMaster.findUnique({
    where: { code },
    select: { code: true, name: true },
  });
  if (!bank) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ code: bank.code, name: bank.name });
}

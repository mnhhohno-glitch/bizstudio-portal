import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// T-097: (金融機関コード+支店コード)→支店名。ログイン確認のみ。
// コードはゼロ詰め（銀行4桁・支店3桁）に正規化してから検索する。

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string; branchCode: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { code: rawBank, branchCode: rawBranch } = await params;
  const bankCode = rawBank.replace(/\D/g, "").padStart(4, "0");
  const branchCode = rawBranch.replace(/\D/g, "").padStart(3, "0");

  const branch = await prisma.branchMaster.findUnique({
    where: { bankCode_branchCode: { bankCode, branchCode } },
    select: { bankCode: true, branchCode: true, name: true },
  });
  if (!branch) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    bankCode: branch.bankCode,
    branchCode: branch.branchCode,
    name: branch.name,
  });
}

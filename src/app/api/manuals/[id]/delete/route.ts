import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { unlink } from "fs/promises";
import path from "path";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.manual.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "マニュアルが見つかりません" }, { status: 404 });
  }

  if (existing.pdfPath) {
    const filePath = path.join(process.cwd(), "public", existing.pdfPath);
    try {
      await unlink(filePath);
    } catch {
      // ファイルが既に削除されている場合は無視
    }
  }

  await prisma.manual.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

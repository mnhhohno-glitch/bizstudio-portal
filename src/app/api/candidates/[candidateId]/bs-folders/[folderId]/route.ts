import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const MAX_NAME_LENGTH = 100;

/**
 * PATCH /api/candidates/[candidateId]/bs-folders/[folderId]
 * フォルダ名変更。同一求職者内で name 重複不可。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; folderId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, folderId } = await params;

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `フォルダ名は1〜${MAX_NAME_LENGTH}文字で入力してください` },
      { status: 400 }
    );
  }

  const folder = await prisma.bSDocumentFolder.findFirst({
    where: { id: folderId, candidateId },
    select: { id: true },
  });
  if (!folder) {
    return NextResponse.json({ error: "フォルダが見つかりません" }, { status: 404 });
  }

  const dup = await prisma.bSDocumentFolder.findFirst({
    where: { candidateId, name, id: { not: folderId } },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json(
      { error: "同じ名前のフォルダが既に存在します" },
      { status: 400 }
    );
  }

  const updated = await prisma.bSDocumentFolder.update({
    where: { id: folderId },
    data: { name },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    sortOrder: updated.sortOrder,
  });
}

/**
 * DELETE /api/candidates/[candidateId]/bs-folders/[folderId]
 * フォルダ削除。配下にファイルが存在する場合は 400。空フォルダのみ削除可。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; folderId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, folderId } = await params;

  const folder = await prisma.bSDocumentFolder.findFirst({
    where: { id: folderId, candidateId },
    select: { id: true, _count: { select: { files: true } } },
  });
  if (!folder) {
    return NextResponse.json({ error: "フォルダが見つかりません" }, { status: 404 });
  }

  if (folder._count.files > 0) {
    return NextResponse.json(
      { error: "フォルダ内のファイルを別フォルダに移すか削除してください" },
      { status: 400 }
    );
  }

  await prisma.bSDocumentFolder.delete({ where: { id: folderId } });

  return NextResponse.json({ success: true });
}

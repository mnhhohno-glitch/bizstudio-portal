import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const MAX_NAME_LENGTH = 100;

/**
 * GET /api/candidates/[candidateId]/bs-folders
 * BS作成書類のサブフォルダ一覧（name 昇順）。各フォルダの fileCount を含む。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const folders = await prisma.bSDocumentFolder.findMany({
    where: { candidateId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sortOrder: true,
      _count: { select: { files: true } },
    },
  });

  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      sortOrder: f.sortOrder,
      fileCount: f._count.files,
    })),
  });
}

/**
 * POST /api/candidates/[candidateId]/bs-folders
 * フォルダ新規作成。同一求職者内で name 重複不可。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `フォルダ名は1〜${MAX_NAME_LENGTH}文字で入力してください` },
      { status: 400 }
    );
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const dup = await prisma.bSDocumentFolder.findFirst({
    where: { candidateId, name },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json(
      { error: "同じ名前のフォルダが既に存在します" },
      { status: 400 }
    );
  }

  const folder = await prisma.bSDocumentFolder.create({
    data: { candidateId, name },
  });

  return NextResponse.json(
    { id: folder.id, name: folder.name, sortOrder: folder.sortOrder },
    { status: 201 }
  );
}

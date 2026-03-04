import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { DocumentStatus } from "@prisma/client";

const VALID_STATUSES: DocumentStatus[] = ["PUBLISHED", "DRAFT"];

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, category, url, status } = body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
  }
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json({ error: "説明文は必須です" }, { status: 400 });
  }
  if (!category || typeof category !== "string" || category.trim().length === 0) {
    return NextResponse.json({ error: "カテゴリは必須です" }, { status: 400 });
  }
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json({ error: "URLは必須です" }, { status: 400 });
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "ステータスが無効です" }, { status: 400 });
  }

  const document = await prisma.document.create({
    data: {
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      url: url.trim(),
      status,
      authorUserId: actor.id,
    },
    include: {
      author: { select: { name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "DOCUMENT_CREATE",
      targetType: "DOCUMENT",
      targetId: document.id,
      metadata: { title: document.title, status: document.status },
    },
  });

  return NextResponse.json(document);
}

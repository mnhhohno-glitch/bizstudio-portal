import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { DocumentStatus } from "@prisma/client";

const VALID_STATUSES: DocumentStatus[] = ["PUBLISHED", "DRAFT"];

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "資料が見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { title, description, category, url, status } = body;

  const updateData: {
    title?: string;
    description?: string;
    category?: string;
    url?: string;
    status?: DocumentStatus;
  } = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
    }
    updateData.title = title.trim();
  }
  if (description !== undefined) {
    if (typeof description !== "string" || description.trim().length === 0) {
      return NextResponse.json({ error: "説明文は必須です" }, { status: 400 });
    }
    updateData.description = description.trim();
  }
  if (category !== undefined) {
    if (typeof category !== "string" || category.trim().length === 0) {
      return NextResponse.json({ error: "カテゴリは必須です" }, { status: 400 });
    }
    updateData.category = category.trim();
  }
  if (url !== undefined) {
    if (typeof url !== "string" || url.trim().length === 0) {
      return NextResponse.json({ error: "URLは必須です" }, { status: 400 });
    }
    updateData.url = url.trim();
  }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "ステータスが無効です" }, { status: 400 });
    }
    updateData.status = status;
  }

  const document = await prisma.document.update({
    where: { id },
    data: updateData,
    include: {
      author: { select: { name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "DOCUMENT_UPDATE",
      targetType: "DOCUMENT",
      targetId: document.id,
      metadata: { title: document.title, status: document.status },
    },
  });

  return NextResponse.json(document);
}

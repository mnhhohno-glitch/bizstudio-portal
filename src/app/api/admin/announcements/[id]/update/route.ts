import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { AnnouncementCategory, AnnouncementStatus } from "@prisma/client";

const VALID_CATEGORIES: AnnouncementCategory[] = ["IMPORTANT", "FEATURE", "FIX", "MAINTENANCE", "RELEASE"];
const VALID_STATUSES: AnnouncementStatus[] = ["PUBLISHED", "DRAFT"];

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "お知らせが見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { title, content, category, status } = body;

  const updateData: {
    title?: string;
    content?: string;
    category?: AnnouncementCategory;
    status?: AnnouncementStatus;
    publishedAt?: Date | null;
  } = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
    }
    updateData.title = title.trim();
  }

  if (content !== undefined) {
    if (typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "本文は必須です" }, { status: 400 });
    }
    updateData.content = content.trim();
  }

  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "カテゴリが無効です" }, { status: 400 });
    }
    updateData.category = category;
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "ステータスが無効です" }, { status: 400 });
    }
    updateData.status = status;

    if (status === "PUBLISHED" && existing.status === "DRAFT") {
      updateData.publishedAt = new Date();
    }
  }

  const announcement = await prisma.announcement.update({
    where: { id },
    data: updateData,
    include: {
      author: {
        select: { name: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "ANNOUNCEMENT_UPDATE",
      targetType: "ANNOUNCEMENT",
      targetId: announcement.id,
      metadata: { title: announcement.title, status: announcement.status },
    },
  });

  return NextResponse.json(announcement);
}

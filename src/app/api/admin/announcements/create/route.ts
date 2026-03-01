import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { AnnouncementCategory, AnnouncementStatus } from "@prisma/client";

const VALID_CATEGORIES: AnnouncementCategory[] = ["IMPORTANT", "FEATURE", "FIX", "MAINTENANCE", "RELEASE"];
const VALID_STATUSES: AnnouncementStatus[] = ["PUBLISHED", "DRAFT"];

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, content, category, status } = body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "本文は必須です" }, { status: 400 });
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "カテゴリが無効です" }, { status: 400 });
  }

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "ステータスが無効です" }, { status: 400 });
  }

  const publishedAt = status === "PUBLISHED" ? new Date() : null;

  const announcement = await prisma.announcement.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      category,
      status,
      publishedAt,
      authorUserId: actor.id,
    },
    include: {
      author: {
        select: { name: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "ANNOUNCEMENT_CREATE",
      targetType: "ANNOUNCEMENT",
      targetId: announcement.id,
      metadata: { title: announcement.title, status: announcement.status },
    },
  });

  return NextResponse.json(announcement);
}

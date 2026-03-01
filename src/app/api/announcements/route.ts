import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { AnnouncementCategory, Prisma } from "@prisma/client";

const VALID_CATEGORIES: AnnouncementCategory[] = ["IMPORTANT", "FEATURE", "FIX", "MAINTENANCE", "RELEASE"];

function getPeriodDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case "1week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "3months":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const category = searchParams.get("category") || "";
  const period = searchParams.get("period") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));

  const where: Prisma.AnnouncementWhereInput = {
    status: "PUBLISHED",
  };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { content: { contains: search, mode: "insensitive" } },
    ];
  }

  if (category && VALID_CATEGORIES.includes(category as AnnouncementCategory)) {
    where.category = category as AnnouncementCategory;
  }

  const periodDate = getPeriodDate(period);
  if (periodDate) {
    where.publishedAt = { gte: periodDate };
  }

  const [total, announcements] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        author: {
          select: { name: true },
        },
      },
    }),
  ]);

  return NextResponse.json({
    announcements,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const systems = await prisma.systemLink.findMany({
    where: { status: "active" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      description: true,
      url: true,
      status: true,
      sortOrder: true,
    },
  });

  return NextResponse.json({ systems });
}

export const dynamic = "force-dynamic";

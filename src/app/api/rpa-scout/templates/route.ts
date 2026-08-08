import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const templates = await prisma.rpaScoutSubjectTemplate.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      subject: true,
      isActive: true,
    },
  });
  return NextResponse.json({ templates });
}

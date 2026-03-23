import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ users });
}

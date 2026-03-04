import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const documents = await prisma.document.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      author: { select: { name: true } },
    },
  });

  return NextResponse.json({ documents });
}

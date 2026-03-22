import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const log = await prisma.rpaErrorLog.findUnique({
    where: { id },
    include: {
      knownError: true,
      registeredUser: { select: { name: true } },
      notes: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
      chat: {
        include: { messages: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!log) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ log });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const { status } = await req.json();

  const validStatuses = ["未対応", "対応中", "解決済み"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "無効なステータスです" }, { status: 400 });
  }

  await prisma.rpaErrorLog.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json({ success: true });
}

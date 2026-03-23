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
      assignee: { select: { id: true, name: true } },
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
  const body = await req.json();

  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const validStatuses = ["未対応", "対応中", "解決済み"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "無効なステータスです" }, { status: 400 });
    }
    data.status = body.status;
  }

  if (body.assigneeId !== undefined) {
    data.assigneeId = body.assigneeId || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  await prisma.rpaErrorLog.update({ where: { id }, data });

  return NextResponse.json({ success: true });
}

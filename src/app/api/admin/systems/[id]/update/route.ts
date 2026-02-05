import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  const name = body?.name;
  const description = body?.description;
  const url = body?.url;
  const sortOrder = body?.sortOrder ?? 0;
  const status = body?.status ?? "active";

  if (!name || typeof name !== "string" || name.length < 1) {
    return NextResponse.json({ error: "名前は必須です" }, { status: 400 });
  }
  if (!description || typeof description !== "string" || description.length < 1) {
    return NextResponse.json({ error: "説明は必須です" }, { status: 400 });
  }
  if (!url || typeof url !== "string" || !isValidUrl(url)) {
    return NextResponse.json({ error: "URLはhttp/httpsで始まる有効なURLを入力してください" }, { status: 400 });
  }
  if (status !== "active" && status !== "disabled") {
    return NextResponse.json({ error: "状態が不正です" }, { status: 400 });
  }

  const { id } = await params;

  const sys = await prisma.systemLink.update({
    where: { id },
    data: {
      name,
      description,
      url,
      sortOrder: Number(sortOrder),
      status,
    },
  });

  await writeAudit({
    actorUserId: actor.id,
    action: "SYSTEM_UPDATED",
    targetType: "SYSTEM",
    targetId: sys.id,
    metadata: { name: sys.name, url: sys.url, status: sys.status, sortOrder: sys.sortOrder },
  });

  return NextResponse.json({ ok: true, system: sys });
}

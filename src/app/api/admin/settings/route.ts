import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: "default_mynavi_assignee_id" },
  });

  return NextResponse.json({ value: setting?.value ?? "" });
}

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { key, value } = await request.json();

  if (key !== "default_mynavi_assignee_id") {
    return NextResponse.json({ error: "無効な設定キーです" }, { status: 400 });
  }

  if (!value) {
    return NextResponse.json({ error: "値は必須です" }, { status: 400 });
  }

  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });

  return NextResponse.json({ ok: true });
}

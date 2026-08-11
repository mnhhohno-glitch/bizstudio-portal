import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { TEMPLATE_KIND_VALUES } from "@/lib/rpa-scout/constants";

// テンプレートの編集／停止・復帰。過去ログから参照されるため物理削除はしない（isActive=false のみ）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const existing = await prisma.rpaScoutSubjectTemplate.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 404 });

  // isActive のみの更新（停止／復帰）は内容を触らない
  if (Object.keys(body).length === 1 && typeof body.isActive === "boolean") {
    const template = await prisma.rpaScoutSubjectTemplate.update({
      where: { id },
      data: { isActive: body.isActive },
    });
    return NextResponse.json({ template });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const mailBody = typeof body.body === "string" ? body.body.trim() : "";
  const kind =
    typeof body.kind === "string" && TEMPLATE_KIND_VALUES.includes(body.kind) ? body.kind : null;

  if (!name) return NextResponse.json({ error: "テンプレ名は必須です" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "件名は必須です" }, { status: 400 });
  if (!mailBody) return NextResponse.json({ error: "本文は必須です" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "種別は必須です" }, { status: 400 });

  const duplicate = await prisma.rpaScoutSubjectTemplate.findFirst({
    where: { name, isActive: true, id: { not: id } },
    select: { id: true },
  });

  const template = await prisma.rpaScoutSubjectTemplate.update({
    where: { id },
    data: { name, kind, subject, body: mailBody },
  });

  return NextResponse.json({ template, duplicateWarning: !!duplicate });
}

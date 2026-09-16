// T-207: 配信テンプレートの更新 / 削除
// テンプレート番号（seq_no）はここでも触らない。一度振った番号は変えない（削除しても後続を詰め直さない）。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseTemplateInput, toTemplateDto } from "@/lib/scout-conditions/templates";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await prisma.scoutTemplate.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const parsed = parseTemplateInput(body as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.data.name !== current.name) {
    const dup = await prisma.scoutTemplate.findFirst({ where: { name: parsed.data.name, id: { not: id } } });
    if (dup) return NextResponse.json({ error: "同じ名前のテンプレートが既にあります" }, { status: 409 });
  }

  const updated = await prisma.scoutTemplate.update({
    where: { id },
    data: { kind: parsed.data.kind, name: parsed.data.name, subject: parsed.data.subject, body: parsed.data.body, isActive: parsed.data.isActive },
  });
  return NextResponse.json({ template: toTemplateDto(updated) });
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await prisma.scoutTemplate.findUnique({
    where: { id },
    select: { id: true, _count: { select: { conditions: true } } },
  });
  if (!current) return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 404 });

  // いずれかの配信条件で使われているテンプレートは削除できない（実績のある条件を消せないのと同じ考え方）。
  // 消してしまうと FK が SetNull なので条件のテンプレートが黙って外れ、RPA が配信文を取れなくなる。
  if (current._count.conditions > 0) {
    return NextResponse.json(
      { error: `配信条件${current._count.conditions}件で使われているため削除できません（使っていない状態にしてから削除してください）` },
      { status: 409 },
    );
  }

  await prisma.scoutTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

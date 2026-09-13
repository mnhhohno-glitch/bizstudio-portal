// T-194: 配信条件の更新（部分更新可）／削除
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  conditionInclude,
  parseConditionInput,
  rowToParsed,
  toConditionDto,
  toPrismaData,
} from "@/lib/scout-conditions/server";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await prisma.scoutCondition.findUnique({ where: { id }, include: conditionInclude });
  if (!current) return NextResponse.json({ error: "条件が見つかりません" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const parsed = parseConditionInput(body as Record<string, unknown>, rowToParsed(current));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.data.machineId !== current.machineId) {
    const machine = await prisma.rpaScoutMachine.findUnique({ where: { id: parsed.data.machineId } });
    if (!machine) return NextResponse.json({ error: "号機が見つかりません" }, { status: 400 });
  }
  if (parsed.data.templateId && parsed.data.templateId !== current.templateId) {
    const t = await prisma.scoutTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!t) return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 400 });
  }

  const { createdById: _ignored, ...data } = toPrismaData(parsed.data, current.createdById);
  void _ignored;
  const updated = await prisma.scoutCondition.update({ where: { id }, data, include: conditionInclude });
  return NextResponse.json({ condition: toConditionDto(updated) });
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await prisma.scoutCondition.findUnique({
    where: { id },
    select: { id: true, _count: { select: { runs: true } } },
  });
  if (!current) return NextResponse.json({ error: "条件が見つかりません" }, { status: 404 });

  // T-195: 実績（scout_runs）が1件でもある条件は削除不可（状態を「完了」にして残す）
  if (current._count.runs > 0) {
    return NextResponse.json({ error: "実績があるため削除できません（状態を「完了」にしてください）" }, { status: 409 });
  }

  await prisma.scoutCondition.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

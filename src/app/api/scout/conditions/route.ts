// T-194: スカウト配信条件コンソール API（一覧＋マスタ取得 / 作成）
// 認証はログインセッション（getSessionUser）。RPA 向け外部 API は次タスクで別途用意する。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { conditionInclude, parseConditionInput, toConditionDto, toPrismaData } from "@/lib/scout-conditions/server";
import { dbDateToYmd } from "@/lib/scout-conditions/dates";
import type { ConditionsResponse } from "@/lib/scout-conditions/types";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [machines, templates, holidays, conditions] = await Promise.all([
    prisma.rpaScoutMachine.findMany({
      orderBy: { machineNo: "asc" },
      select: { id: true, machineNo: true, isActive: true, defaultTemplateId: true },
    }),
    prisma.scoutTemplate.findMany({
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.scoutCondition.findMany({
      include: conditionInclude,
      orderBy: [{ machine: { machineNo: "asc" } }, { status: "asc" }, { queueOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const res: ConditionsResponse = {
    machines,
    templates: templates.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      subject: t.subject,
      body: t.body,
      sortOrder: t.sortOrder,
      isActive: t.isActive,
    })),
    holidays: holidays.map((h) => ({ date: dbDateToYmd(h.date)!, name: h.name })),
    conditions: conditions.map(toConditionDto),
  };
  return NextResponse.json(res);
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const parsed = parseConditionInput(body as Record<string, unknown>, null);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const machine = await prisma.rpaScoutMachine.findUnique({ where: { id: parsed.data.machineId } });
  if (!machine) return NextResponse.json({ error: "号機が見つかりません" }, { status: 400 });
  if (parsed.data.templateId) {
    const t = await prisma.scoutTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!t) return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 400 });
  }

  // queueOrder 未指定（0）の予約は号機内の末尾に付ける
  let data = toPrismaData(parsed.data, actor.id);
  if (data.status === "QUEUED" && (body as Record<string, unknown>).queueOrder === undefined) {
    const max = await prisma.scoutCondition.aggregate({
      where: { machineId: data.machineId, status: "QUEUED" },
      _max: { queueOrder: true },
    });
    data = { ...data, queueOrder: (max._max.queueOrder ?? 0) + 1 };
  }

  const created = await prisma.scoutCondition.create({ data, include: conditionInclude });
  return NextResponse.json({ condition: toConditionDto(created) }, { status: 201 });
}

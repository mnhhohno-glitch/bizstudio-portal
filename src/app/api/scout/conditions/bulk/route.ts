// T-194: 配信条件の一括操作（複製 / 削除）。CSV は画面側で生成する。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { conditionInclude, toConditionDto } from "@/lib/scout-conditions/server";

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  const { action, ids } = body as { action?: unknown; ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string"))
    return NextResponse.json({ error: "対象を選択してください" }, { status: 400 });
  const targetIds = ids as string[];

  if (action === "delete") {
    const r = await prisma.scoutCondition.deleteMany({ where: { id: { in: targetIds } } });
    return NextResponse.json({ ok: true, deleted: r.count });
  }

  if (action === "duplicate") {
    const sources = await prisma.scoutCondition.findMany({
      where: { id: { in: targetIds } },
      orderBy: [{ machine: { machineNo: "asc" } }, { queueOrder: "asc" }],
    });
    if (sources.length === 0) return NextResponse.json({ error: "条件が見つかりません" }, { status: 404 });

    // 複製は「予約」として同じ号機の末尾へ。配信日は引き継がない（登録者は操作者）
    const maxes = await prisma.scoutCondition.groupBy({
      by: ["machineId"],
      where: { machineId: { in: [...new Set(sources.map((s) => s.machineId))] }, status: "QUEUED" },
      _max: { queueOrder: true },
    });
    const nextOrder = new Map(maxes.map((m) => [m.machineId, (m._max.queueOrder ?? 0) + 1]));

    const created = await prisma.$transaction(
      sources.map((s) => {
        const order = nextOrder.get(s.machineId) ?? 1;
        nextOrder.set(s.machineId, order + 1);
        return prisma.scoutCondition.create({
          data: {
            machineId: s.machineId,
            status: "QUEUED",
            queueOrder: order,
            searchTarget: s.searchTarget,
            registDateMode: s.registDateMode,
            registDays: s.registDays,
            registDateFrom: s.registDateFrom,
            registDateTo: s.registDateTo,
            lastLoginDays: s.lastLoginDays,
            gradYearFrom: s.gradYearFrom,
            gradYearTo: s.gradYearTo,
            companyCount: s.companyCount,
            areaMode: s.areaMode,
            prefectures: s.prefectures,
            templateId: s.templateId,
            plannedCount: s.plannedCount,
            deliveryDate: null,
            createdById: actor.id,
          },
          include: conditionInclude,
        });
      }),
    );
    return NextResponse.json({ ok: true, conditions: created.map(toConditionDto) }, { status: 201 });
  }

  return NextResponse.json({ error: "action は duplicate / delete のいずれかです" }, { status: 400 });
}

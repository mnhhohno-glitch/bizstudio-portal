// T-194: 配信条件の一括操作（複製 / 削除）。CSV は画面側で生成する。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { toConditionDto } from "@/lib/scout-conditions/server";
import { moveQueuedCondition } from "@/lib/scout-conditions/queue";
import { createScoutCondition } from "@/lib/scout-conditions/create";

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  const { action, ids, id, direction } = body as { action?: unknown; ids?: unknown; id?: unknown; direction?: unknown };

  // T-195: 予約の並べ替え（上へ／下へ）。同じ号機の中でだけ入れ替える
  if (action === "move") {
    if (typeof id !== "string" || (direction !== "up" && direction !== "down"))
      return NextResponse.json({ error: "id と direction（up/down）を指定してください" }, { status: 400 });
    const r = await moveQueuedCondition(id, direction);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, conditions: r.conditions, moved: r.moved });
  }

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string"))
    return NextResponse.json({ error: "対象を選択してください" }, { status: 400 });
  const targetIds = ids as string[];

  if (action === "delete") {
    // T-195: 実績（scout_runs）がある条件は飛ばして、削除した件数と飛ばした件数を返す
    const withRuns = await prisma.scoutCondition.findMany({
      where: { id: { in: targetIds }, runs: { some: {} } },
      select: { id: true },
    });
    const skippedIds = withRuns.map((c) => c.id);
    const deletable = targetIds.filter((x) => !skippedIds.includes(x));
    if (deletable.length === 0 && skippedIds.length > 0) {
      return NextResponse.json(
        { error: "実績があるため削除できません（状態を「完了」にしてください）", deleted: 0, skipped: skippedIds.length, skippedIds },
        { status: 409 },
      );
    }
    const r = deletable.length ? await prisma.scoutCondition.deleteMany({ where: { id: { in: deletable } } }) : { count: 0 };
    return NextResponse.json({ ok: true, deleted: r.count, deletedIds: deletable, skipped: skippedIds.length, skippedIds });
  }

  if (action === "duplicate") {
    const sources = await prisma.scoutCondition.findMany({
      where: { id: { in: targetIds } },
      orderBy: [{ machine: { machineNo: "asc" } }, { queueOrder: "asc" }],
    });
    if (sources.length === 0) return NextResponse.json({ error: "条件が見つかりません" }, { status: 404 });

    // 複製は同じ号機へ新規作成として登録する。状態は T-197 の自動決定（実行中が無ければ実行中、あれば予約の末尾）。
    // 配信日は引き継がない（登録者は操作者）。1件ずつ号機ロックの中で採番するため直列に作る
    const created = [];
    for (const s of sources) {
      created.push(
        await createScoutCondition({
          machineId: s.machineId,
          searchTarget: s.searchTarget,
          registDateMode: s.registDateMode,
          registDays: s.registDays,
          registDateFrom: s.registDateFrom,
          registDateTo: s.registDateTo,
          lastLoginDays: s.lastLoginDays,
          gradYearFrom: s.gradYearFrom,
          gradYearTo: s.gradYearTo,
          companyCount: s.companyCount,
          residenceMode: s.residenceMode,
          residencePrefectures: s.residencePrefectures,
          workPrefMode: s.workPrefMode,
          workPrefectures: s.workPrefectures,
          templateId: s.templateId,
          plannedCount: s.plannedCount,
          deliveryDate: null,
          createdById: actor.id,
        }),
      );
    }
    return NextResponse.json({ ok: true, conditions: created.map(toConditionDto) }, { status: 201 });
  }

  return NextResponse.json({ error: "action は duplicate / delete / move のいずれかです" }, { status: 400 });
}

// T-194: スカウト配信条件コンソール API（一覧＋マスタ取得 / 作成）
// 認証はログインセッション（getSessionUser）。RPA 向け外部 API は /api/external/scout-conditions（T-195）。
// T-197: 作成時の状態（RUNNING/QUEUED）と並び順・レコード番号はサーバー側（create.ts）で決める。body の status/queueOrder は無視する。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { attachListDuplicates, conditionInclude, parseConditionInput, toConditionDto, toPrismaData } from "@/lib/scout-conditions/server";
import { createScoutCondition, ensureSeqNos } from "@/lib/scout-conditions/create";
import { runDateRolloverForActiveMachines } from "@/lib/scout-conditions/activate";
import { ensureTemplateSeqNos, templateOrderBy, toTemplateDto } from "@/lib/scout-conditions/templates";
import { dbDateToYmd, jstTodayYmd } from "@/lib/scout-conditions/dates";
import type { ConditionsResponse } from "@/lib/scout-conditions/types";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // T-197: 旧コードが動いていた窓で作られた seq_no 空の行があれば番号を振る（通常は0件）
  await ensureSeqNos();
  // T-207: テンプレート番号（T-001）も同じ理由で空行を補っておく（通常は0件）
  await ensureTemplateSeqNos();

  // T-210: 日付切替（前日の有効を完了 → 予約の先頭を有効）を号機ごとに通す。
  //   人が手で切り替えなくても、その日の朝に一覧を開いた時点で当日の条件が走る状態になる
  //   （RPA の GET /api/external/scout-conditions/current でも同じ判定をする）。
  await runDateRolloverForActiveMachines();

  const [machines, templates, holidays, conditions] = await Promise.all([
    prisma.rpaScoutMachine.findMany({
      orderBy: { machineNo: "asc" },
      select: { id: true, machineNo: true, isActive: true, defaultTemplateId: true, queueEmptyTaskId: true },
    }),
    prisma.scoutTemplate.findMany({ orderBy: templateOrderBy }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.scoutCondition.findMany({
      include: conditionInclude,
      orderBy: [{ machine: { machineNo: "asc" } }, { status: "asc" }, { queueOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  // T-195: 予約切れタスク（未完了のものだけ）を号機に添える。警告帯の「ポータルタスク作成済」リンク用
  const taskIds = machines.map((m) => m.queueEmptyTaskId).filter((v): v is string => !!v);
  const openTasks = taskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: taskIds }, status: { not: "COMPLETED" } },
        select: { id: true, title: true },
      })
    : [];
  const openTaskById = new Map(openTasks.map((t) => [t.id, t]));

  const res: ConditionsResponse = {
    machines: machines.map(({ queueEmptyTaskId, ...m }) => ({
      ...m,
      queueEmptyTask: (queueEmptyTaskId && openTaskById.get(queueEmptyTaskId)) || null,
    })),
    templates: templates.map(toTemplateDto),
    holidays: holidays.map((h) => ({ date: dbDateToYmd(h.date)!, name: h.name })),
    // T-216: 有効・予約の条件に、同じ配信日の他号機（稼働中）で 7軸すべてが一致する相手のレコード番号を付ける（一覧の「重複」印）
    conditions: attachListDuplicates(
      conditions.map(toConditionDto),
      new Set(machines.filter((m) => m.isActive).map((m) => m.id)),
      jstTodayYmd(),
    ),
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

  // T-197: 状態・並び順・レコード番号はサーバーが決める（号機に実行中が無ければ実行中、あれば予約の末尾）
  const { status: _status, queueOrder: _order, ...data } = toPrismaData(parsed.data, actor.id);
  void _status;
  void _order;
  const created = await createScoutCondition(data);
  return NextResponse.json({ condition: toConditionDto(created) }, { status: 201 });
}

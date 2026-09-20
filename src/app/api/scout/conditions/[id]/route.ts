// T-194: 配信条件の更新（部分更新可）／削除
// T-198: 手動で「実行中」に戻したときは、同じ号機の他の「実行中」を自動で「完了」に畳む（実行中は号機ごとに1件）。
//   畳んだ行は demoted として返し、画面が再読込なしで表示を合わせられるようにする。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  changedLockedFields,
  conditionInclude,
  editorStamp,
  parseConditionInput,
  rowToParsed,
  toConditionDto,
  toPrismaData,
} from "@/lib/scout-conditions/server";
import { demoteOtherRunning, lockMachine, type CreatedCondition } from "@/lib/scout-conditions/create";

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

  // T-201: 配信実績（scout_runs）がある条件は状態以外を変更できない。
  //   画面側でも入力欄を無効化しているが、直接 PATCH を投げられても通らないようここでも弾く。
  //   比較の基準は「今の行を parseConditionInput に通した値」にする（正規化前の行と比べると誤検知する）。
  if (current.runs.length > 0) {
    const baseParsed = parseConditionInput({}, rowToParsed(current));
    const before = baseParsed.ok ? baseParsed.data : rowToParsed(current);
    const changed = changedLockedFields(before, parsed.data);
    if (changed.length > 0) {
      return NextResponse.json(
        {
          error: `配信実績があるため、状態以外は変更できません（${changed.join("・")}）。内容を変えるには複製してください`,
        },
        { status: 409 },
      );
    }
  }

  if (parsed.data.machineId !== current.machineId) {
    const machine = await prisma.rpaScoutMachine.findUnique({ where: { id: parsed.data.machineId } });
    if (!machine) return NextResponse.json({ error: "号機が見つかりません" }, { status: 400 });
  }
  if (parsed.data.templateId && parsed.data.templateId !== current.templateId) {
    const t = await prisma.scoutTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!t) return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 400 });
  }

  const { createdById: _ignored, ...baseData } = toPrismaData(parsed.data, current.createdById);
  void _ignored;
  // T-214: 編集モーダルの保存・手動の状態変更はどちらもこの PATCH を通る＝人が保存した操作なので更新者・更新日時を付ける
  const data = { ...baseData, ...editorStamp(actor.id) };

  // T-198: RUNNING にする更新は号機ロックの中で行い、他の RUNNING を DONE に畳む
  const goesRunning = data.status === "RUNNING";
  const machineId = parsed.data.machineId;
  const { updated, demoted } = await prisma.$transaction(
    async (t): Promise<{ updated: CreatedCondition; demoted: CreatedCondition[] }> => {
      if (!goesRunning) {
        const u = await t.scoutCondition.update({ where: { id }, data, include: conditionInclude });
        return { updated: u, demoted: [] };
      }
      await lockMachine(t, machineId);
      // 畳む対象の id はロックの中で先に控える（畳んだ後は status では引けないため）
      const targets = await t.scoutCondition.findMany({
        where: { machineId, status: "RUNNING", id: { not: id } },
        select: { id: true },
      });
      const u = await t.scoutCondition.update({ where: { id }, data, include: conditionInclude });
      await demoteOtherRunning(t, machineId, id);
      const rows = targets.length
        ? await t.scoutCondition.findMany({ where: { id: { in: targets.map((x) => x.id) } }, include: conditionInclude })
        : [];
      return { updated: u, demoted: rows };
    },
    { timeout: 20000 },
  );

  return NextResponse.json({
    condition: toConditionDto(updated),
    demoted: demoted.map(toConditionDto),
  });
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

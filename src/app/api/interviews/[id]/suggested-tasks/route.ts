// T-151 Phase 2-6: 面談ログ解析が検出したタスク候補の「起票」「破棄」を受けるエンドポイント。
//
// PATCH body:
//   { action: "dismiss" }                                        … 候補をまとめて破棄（カードを消す）
//   { action: "create", kind, dueDate: "YYYY-MM-DD" }            … タスクを upsert する
//
// ★create では破棄フラグを立てない。候補が複数あるとき、1件起票しただけで
//   suggestedTasksDismissedAt が入るとカード全体が消え、残りの候補を起票できなくなるため。
//   カードを閉じるのは「全候補が処理済みになった」と判断した画面側が dismiss を送ったときだけ。
//
// 起票ロジック本体は src/lib/ai-task-create.ts（AIアドバイザー経路と共通）。
// このファイルは「面談レコードの存在確認」と「破棄フラグの記録」だけを担う。
//
// ★source は "AI_ADVISOR" を共用する（経路で分けない）。分けると部分ユニークインデックス
//   tasks_ai_advisor_one_open_per_kind が面談起票分を対象にせず、同じ約束のタスクが
//   アドバイザー経由と面談経由で2件立ちうるため。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { type SuggestedTaskKind } from "@/lib/advisor/suggested-tasks";
import { createAiTask, validateAiTaskInput } from "@/lib/ai-task-create";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: interviewId } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action;

  const record = await prisma.interviewRecord.findUnique({
    where: { id: interviewId },
    select: { id: true, candidateId: true, suggestedTasksDismissedAt: true },
  });
  if (!record) return NextResponse.json({ error: "面談記録が見つかりません" }, { status: 404 });

  // ---- 破棄 ----
  if (action === "dismiss") {
    // 既に非 null なら何もしない（冪等）
    if (!record.suggestedTasksDismissedAt) {
      await prisma.interviewRecord.update({
        where: { id: interviewId },
        data: { suggestedTasksDismissedAt: new Date() },
      });
    }
    return NextResponse.json({ ok: true, dismissed: true });
  }

  // ---- 起票 ----
  if (action !== "create") {
    return NextResponse.json({ error: "action は create / dismiss のみです" }, { status: 400 });
  }

  const invalid = validateAiTaskInput(body?.kind, body?.dueDate);
  if (invalid) return NextResponse.json({ error: invalid.error }, { status: invalid.status });

  const result = await createAiTask({
    candidateId: record.candidateId,
    kind: body.kind as SuggestedTaskKind,
    dueDateStr: (body.dueDate as string).trim(),
    origin: "interview",
    actor: { id: actor.id, name: actor.name },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    taskId: result.taskId,
    created: result.created,
    dueDate: result.dueDate,
  });
}

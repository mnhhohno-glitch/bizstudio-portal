// T-150 Phase 2-3: AIアドバイザーが検出したタスク候補の「起票」「破棄」を受けるエンドポイント。
//
// PATCH body:
//   { action: "dismiss" }                                        … 候補を破棄（カードを消す）
//   { action: "create", kind, dueDate: "YYYY-MM-DD" }            … タスクを upsert して破棄も記録
//
// T-151 Phase 2-2: 起票ロジック本体は src/lib/ai-task-create.ts に切り出し済み。
//   面談ログ経由（/api/interviews/[id]/suggested-tasks）と同じ実装を共有し、
//   カテゴリID・必須フィールド埋め・upsert 条件が二重定義されるのを防ぐ。
//   このファイルは「メッセージの所有確認」と「破棄フラグの記録」だけを担う。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { type SuggestedTaskKind } from "@/lib/advisor/suggested-tasks";
import { createAiTask, validateAiTaskInput } from "@/lib/ai-task-create";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; sessionId: string; messageId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, sessionId, messageId } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action;

  // メッセージがこのセッション・この求職者のものであることを確認する。
  const message = await prisma.advisorChatMessage.findFirst({
    where: { id: messageId, sessionId, session: { candidateId } },
    select: { id: true, suggestedTasks: true, suggestedTasksDismissedAt: true },
  });
  if (!message) return NextResponse.json({ error: "メッセージが見つかりません" }, { status: 404 });

  // ---- 破棄 ----
  if (action === "dismiss") {
    // 既に非 null なら何もしない（冪等）
    if (!message.suggestedTasksDismissedAt) {
      await prisma.advisorChatMessage.update({
        where: { id: messageId },
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
    candidateId,
    kind: body.kind as SuggestedTaskKind,
    dueDateStr: (body.dueDate as string).trim(),
    origin: "advisor",
    actor: { id: actor.id, name: actor.name },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // カードを消すため、起票したメッセージの候補も破棄済みにする。
  if (!message.suggestedTasksDismissedAt) {
    await prisma.advisorChatMessage.update({
      where: { id: messageId },
      data: { suggestedTasksDismissedAt: new Date() },
    });
  }

  return NextResponse.json({
    ok: true,
    taskId: result.taskId,
    created: result.created,
    dueDate: result.dueDate,
  });
}

// T-139 Task2: PATCH /api/external/schedule-tasks/[taskId]
// 日程調整AIエージェント（外部RPA機）がタスクの status 変更 / コメント追加を行う更新API。
// 安全柵: 対象がカテゴリ「日程調整」でなければ 403（一切更新しない）。存在しなければ 404。
// T-177 変更点:
//   (a) status=COMPLETED は IN_PROGRESS（対応中）へ読み替えて保存する。AIが返信を送った時点では
//       面談日程が確定したとは限らず、完了にすると一覧APIの既定フィルタで黙って消えるため。
//       完了操作は人が内容を確認してから画面（/api/tasks/[taskId]/status）で行う。
//   (b) AIによる **初回** の更新時だけ LINE WORKS 通知を出す。従来は通知を一切出さない設計で、
//       AIが完了化してもCA・事務が気づけなかった。二重通知は「更新前に【日程調整AI】コメントが
//       既にあるか」で抑止する＝夜間ポーリングでの通知連発は起きない。
//       通知はフェイルソフト（失敗しても 200 を返す）。
import { NextResponse } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AI_COMMENT_PREFIX,
  EMPTY_SCHEDULE_COMMENT_FLAGS,
  SCHEDULE_CATEGORY_NAME,
  VALID_TASK_STATUSES,
  isAuthorizedExternal,
  loadScheduleCommentFlags,
  resolveStoredStatus,
  resolveSystemUserId,
  scheduleTaskInclude,
  serializeScheduleTask,
} from "@/lib/schedule-tasks";
import {
  notifyScheduleAiTaskUpdated,
  resolveAssigneeNotifyTargets,
} from "@/lib/task-notification";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  let body: { status?: unknown; comment?: unknown };
  try {
    body = (await request.json()) as { status?: unknown; comment?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // status / comment は両方任意だが、少なくとも一方は必須。
  const hasStatus = body.status !== undefined && body.status !== null;
  const hasComment = body.comment !== undefined && body.comment !== null;
  if (!hasStatus && !hasComment) {
    return NextResponse.json({ error: "status または comment のいずれかが必要です" }, { status: 400 });
  }

  // status 検証（許可値のみ）。許可外は従来どおり 400。
  let requestedStatus: TaskStatus | null = null;
  let storedStatus: TaskStatus | null = null;
  if (hasStatus) {
    const s = String(body.status);
    if (!VALID_TASK_STATUSES.includes(s as (typeof VALID_TASK_STATUSES)[number])) {
      return NextResponse.json(
        { error: `無効なstatus: ${s}（許可値: ${VALID_TASK_STATUSES.join(", ")}）` },
        { status: 400 },
      );
    }
    requestedStatus = s as TaskStatus;
    // T-177: COMPLETED → IN_PROGRESS の読み替え。HTTPは 200 のまま返し、
    // レスポンスの status は実際に保存した値（= updated.status）になる。
    storedStatus = resolveStoredStatus(requestedStatus);
  }

  // comment 検証。
  let commentContent: string | null = null;
  if (hasComment) {
    const c = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!c) {
      return NextResponse.json({ error: "comment は空にできません" }, { status: 400 });
    }
    if (c.length > 2000) {
      return NextResponse.json({ error: "comment は2000文字以内で指定してください" }, { status: 400 });
    }
    commentContent = c;
  }

  // 対象タスク取得（存在確認＋カテゴリ柵）。
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, category: { select: { name: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
  }
  if (task.category?.name !== SCHEDULE_CATEGORY_NAME) {
    // 日程調整以外は一切触らない。
    return NextResponse.json({ error: "対象タスクは日程調整カテゴリではありません" }, { status: 403 });
  }

  // T-177: 二重通知の抑止判定は **今回の更新を反映する前** に行う。
  // ここより後でコメントを作るため、この時点の値が「AIの初回更新かどうか」を表す。
  const alreadyNotifiedByAi = await prisma.taskComment.count({
    where: { taskId, content: { contains: AI_COMMENT_PREFIX } },
  });
  const isFirstAiUpdate = alreadyNotifiedByAi === 0;

  // コメント作者（TaskComment.userId 必須）はシステムユーザー。本文に AI 接頭辞を付けて人間が判別可能に。
  if (commentContent) {
    const systemUserId = await resolveSystemUserId();
    if (!systemUserId) {
      return NextResponse.json({ error: "コメント作者のシステムユーザーが見つかりません" }, { status: 500 });
    }
    await prisma.taskComment.create({
      data: {
        taskId,
        userId: systemUserId,
        content: `${AI_COMMENT_PREFIX} ${commentContent}`,
      },
    });
  }

  // status 更新（T-177: 読み替え後の storedStatus を保存する）。
  if (storedStatus) {
    await prisma.task.update({ where: { id: taskId }, data: { status: storedStatus } });
  }

  // 更新後のタスクを GET と同じ形状で返す。
  const updated = await prisma.task.findUnique({
    where: { id: taskId },
    include: scheduleTaskInclude,
  });
  if (!updated) {
    return NextResponse.json({ error: "更新後のタスク取得に失敗しました" }, { status: 500 });
  }
  const flags = (await loadScheduleCommentFlags([taskId])).get(taskId) ?? EMPTY_SCHEDULE_COMMENT_FLAGS;

  // T-177: AIの初回更新時のみ LINE WORKS へ通知。フェイルソフト（絶対に throw させない）。
  let notifyOutcome: string;
  if (!isFirstAiUpdate) {
    notifyOutcome = "skipped(already-ai-updated)";
  } else {
    try {
      // scheduleTaskInclude は候補者名を含まない（RPA向けレスポンスに不要）ため、
      // 通知本文に出す名前だけをこの分岐でピンポイントに引く。GETの取得内容は変えない。
      const candidate = updated.candidateId
        ? await prisma.candidate.findUnique({
            where: { id: updated.candidateId },
            select: { name: true },
          })
        : null;
      const targets = await resolveAssigneeNotifyTargets(updated.assignees.map((a) => a.employee.id));
      const sent = await notifyScheduleAiTaskUpdated({
        taskId: updated.id,
        title: updated.title,
        candidateName: candidate?.name ?? null,
        storedStatus: updated.status,
        commentContent,
        assigneeNames: targets.map((t) => t.name),
        assigneeLineworksIds: targets.map((t) => t.lineworksId),
      });
      notifyOutcome = sent ? "sent" : "skipped(no-env)";
    } catch (e) {
      notifyOutcome = "failed";
      console.error(`[schedule-tasks:external-patch] task=${taskId} 通知に失敗しました:`, e);
    }
  }

  // T-177: このルートは従来ログが1行も無く Railway ログから追跡できなかった。1リクエスト1行で残す。
  console.log(
    `[schedule-tasks:external-patch] task=${taskId}` +
      ` requestedStatus=${requestedStatus ?? "none"} storedStatus=${storedStatus ?? "unchanged"}` +
      ` downgraded=${requestedStatus !== null && requestedStatus !== storedStatus}` +
      ` comment=${commentContent ? "yes" : "no"} firstAiUpdate=${isFirstAiUpdate} notify=${notifyOutcome}`,
  );

  return NextResponse.json(serializeScheduleTask(updated, flags));
}

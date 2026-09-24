// T-195: 予約（QUEUED）が空のまま枯渇したときの LINE WORKS 通知とポータルタスク起票。
//
// - 通知は既存のタスク通知ヘルパーと同じ経路（lineworks.sendBotMessage × LINEWORKS_TASK_BOT_ID/CHANNEL_ID）。
//   新規に送信経路は作らない。notifyTaskCreated 等の内部ヘルパーは呼ばない（夜間の連発防止。T-139 と同方針）。
// - 重複防止: RpaScoutMachine.queueEmptyTaskId が指すタスクが未完了の間は新規起票しない。
//   通知も未完了タスクがある間は JST 1日1回まで（queueEmptyNotifiedAt で判定）。
// - 担当者は Employee を氏名で引く。見つからない氏名は飛ばして残りに割り当て、戻り値で報告する（起票自体は失敗させない）。
import type { Prisma, RpaScoutMachine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";
import { resolveSystemUserId } from "@/lib/schedule-tasks";
import { instantToJstYmd, jstTodayYmd } from "./dates";
import { conditionLabel, type ConditionLabelRow } from "./label";

export const SCOUT_TASK_CATEGORY_NAME = "スカウト配信";
export const SCOUT_QUEUE_EMPTY_SOURCE = "SCOUT_CONDITIONS";
export const SCOUT_QUEUE_EMPTY_SOURCE_KIND = "SCOUT_QUEUE_EMPTY";

/** 予約が空のときのタスク担当（2026-09-14 決定）。Employee.name と空白を無視して照合する。 */
export const QUEUE_EMPTY_ASSIGNEE_NAMES = ["佐藤 葵", "見ル野 未来", "道西 未来", "大野 望", "大野 将幸"] as const;

function normalizeName(s: string): string {
  return s.replace(/[\s　]/g, "");
}

/** スカウト系の LINE WORKS 1行通知。環境変数が無ければ送らずログのみ。絶対に throw しない。 */
export async function sendScoutLine(text: string): Promise<boolean> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  if (!botId || !channelId) {
    console.warn("[scout-conditions] LINEWORKS_TASK_* が未設定のため通知をスキップ:", text);
    return false;
  }
  try {
    await sendBotMessage(botId, channelId, text);
    return true;
  } catch (e) {
    console.error("[scout-conditions] LINE WORKS 通知に失敗:", e);
    return false;
  }
}

/** 号機に紐づく「スカウト配信」タスクのうち未完了のもの（無ければ null）。 */
export async function findOpenQueueEmptyTask(machine: Pick<RpaScoutMachine, "queueEmptyTaskId">) {
  if (!machine.queueEmptyTaskId) return null;
  return prisma.task.findFirst({
    where: { id: machine.queueEmptyTaskId, status: { not: "COMPLETED" } },
    select: { id: true, title: true, status: true },
  });
}

/** 「スカウト配信」カテゴリ（無ければ作る。seed の upsertCategory と同じ findFirst→create）。 */
export async function ensureScoutTaskCategory() {
  const existing = await prisma.taskCategory.findFirst({ where: { name: SCOUT_TASK_CATEGORY_NAME } });
  if (existing) return existing;
  return prisma.taskCategory.create({ data: { name: SCOUT_TASK_CATEGORY_NAME, sortOrder: 7 } });
}

/** 担当者 Employee を氏名で解決。見つからない氏名は missing に入れる。 */
export async function resolveQueueEmptyAssignees(): Promise<{ employeeIds: string[]; missing: string[] }> {
  const emps = await prisma.employee.findMany({ where: { status: "active" }, select: { id: true, name: true } });
  const byName = new Map(emps.map((e) => [normalizeName(e.name), e.id]));
  const employeeIds: string[] = [];
  const missing: string[] = [];
  for (const n of QUEUE_EMPTY_ASSIGNEE_NAMES) {
    const id = byName.get(normalizeName(n));
    if (id) employeeIds.push(id);
    else missing.push(n);
  }
  return { employeeIds, missing };
}

export type QueueEmptyOutcome = {
  taskId: string | null;
  taskCreated: boolean;
  notified: boolean;
  missingAssignees: string[];
};

/**
 * 予約が空のまま枯渇した号機の後処理（通知＋タスク起票）。runs.ts の切替判定の後に呼ぶ。
 * 失敗しても throw しない（実績記録の成否に影響させない）。
 */
export async function handleQueueEmpty(params: {
  machine: RpaScoutMachine;
  condition: ConditionLabelRow;
  sentCount: number;
}): Promise<QueueEmptyOutcome> {
  const { machine, condition, sentCount } = params;
  const label = conditionLabel(condition);
  const baseUrl = process.env.PORTAL_BASE_URL ?? "";
  const line = `【スカウト】${machine.machineNo}号機：予約が空です。条件「${label}」（枯渇・送信${sentCount}件）のまま配信を続けています`;
  const out: QueueEmptyOutcome = { taskId: null, taskCreated: false, notified: false, missingAssignees: [] };

  try {
    const open = await findOpenQueueEmptyTask(machine);
    if (open) {
      out.taskId = open.id;
      // 未完了タスクがある間は通知を JST 1日1回に抑える
      const today = jstTodayYmd();
      const lastDay = machine.queueEmptyNotifiedAt ? instantToJstYmd(machine.queueEmptyNotifiedAt) : null;
      if (lastDay !== today) {
        out.notified = await sendScoutLine(`${line}\n🔗 ${baseUrl}/tasks/${open.id}`);
        if (out.notified) {
          await prisma.rpaScoutMachine.update({ where: { id: machine.id }, data: { queueEmptyNotifiedAt: new Date() } });
        }
      } else {
        console.log(`[scout-conditions] queue-empty notify skipped (already notified today) machine=${machine.machineNo}`);
      }
      return out;
    }

    // 新規起票
    const createdByUserId = await resolveSystemUserId();
    if (!createdByUserId) {
      console.error("[scout-conditions] タスク作成者（システムユーザー）を解決できません");
      out.notified = await sendScoutLine(line);
      return out;
    }
    const [category, assignees] = await Promise.all([ensureScoutTaskCategory(), resolveQueueEmptyAssignees()]);
    out.missingAssignees = assignees.missing;
    if (assignees.missing.length) {
      console.warn(`[scout-conditions] 担当者が見つかりません: ${assignees.missing.join("・")}`);
    }

    const description = [
      `${machine.machineNo}号機の予約（順番待ちの条件）が空のまま、実行中の条件が枯渇しました（送信${sentCount}件）。`,
      "配信は現在の条件のまま続いています。スカウト配信条件コンソールで次の条件を予約してください。",
      "",
      `■ 実行中の条件: ${label}`,
      condition.template ? `■ 配信テンプレート: ${condition.template.name}` : null,
      `■ 条件ID: ${condition.id}`,
      "",
      `🔗 ${baseUrl}/scout/conditions`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const data: Prisma.TaskUncheckedCreateInput = {
      title: `【スカウト】${machine.machineNo}号機の予約が空です（条件「${label}」のまま継続中）`,
      description,
      categoryId: category.id,
      status: "NOT_STARTED",
      priority: "HIGH",
      createdByUserId,
      completionType: "any",
      source: SCOUT_QUEUE_EMPTY_SOURCE,
      sourceKind: SCOUT_QUEUE_EMPTY_SOURCE_KIND,
      assignees: { create: assignees.employeeIds.map((employeeId) => ({ employeeId })) },
    };
    const task = await prisma.task.create({ data, select: { id: true } });
    out.taskId = task.id;
    out.taskCreated = true;

    out.notified = await sendScoutLine(`${line}\n🔗 ${baseUrl}/tasks/${task.id}`);
    await prisma.rpaScoutMachine.update({
      where: { id: machine.id },
      data: { queueEmptyTaskId: task.id, queueEmptyNotifiedAt: out.notified ? new Date() : null },
    });
    return out;
  } catch (e) {
    console.error("[scout-conditions] 予約切れの通知/タスク起票に失敗:", e);
    return out;
  }
}

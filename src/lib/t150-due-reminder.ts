// T-150 Phase 2-4: AI起票タスクの期日リマインド（期日当日の朝／期日超過中は毎朝）の共有ロジック。
//
// /api/internal/tasks/due-reminder（GitHub Actions cron・JST 07:00）から呼ぶ。
// スクリプトからも同じ関数を叩けるよう、本体はここに集約する（t131-resubmit-stale.ts と同じ構成）。
//
// ★通知対象は source="AI_ADVISOR" に限定する（最重要）。
//   本番実測（2026-08-02）では未完了かつ期日ありのタスク60件が **すべて期日超過** で、
//   担当者4名に紐づいている。全タスクを対象にすると初日の朝に60件が飛び、完了されるまで
//   毎朝繰り返すため、通知そのものが無視される機能になる。
//   将来「全タスク対象」に広げる可能性があるので、対象条件は buildDueReminderWhere() に集約し、
//   コード内に条件を散らさない。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jstYmd } from "@/lib/schedule-agent/jst";
import { notifyAiTaskDueReminder, type DueReminderItem } from "@/lib/task-notification";

/** 通知対象の起票元。ここを変えるだけで対象範囲を切り替えられる。 */
export const DUE_REMINDER_SOURCE = "AI_ADVISOR";

/** 1回の実行で本文に列挙する最大件数。超過分は「他N件」に畳む。 */
export const DUE_REMINDER_MAX_ITEMS = 20;

/**
 * 対象タスクの抽出条件（★対象範囲の唯一の定義）。
 *
 * dueDate は "YYYY-MM-DD" を new Date() に渡して保存しているため、DB 上は
 * その暦日の UTC 0:00（= timestamp without time zone の 00:00:00）になっている。
 * 「JST 今日まで（当日を含む）」は「JST 翌日の UTC 0:00 未満」で表す。
 * 罠#17: Railway は UTC 稼働。new Date().getDay() / toISOString().slice(0,10) は使わない。
 */
export function buildDueReminderWhere(todayYmd: string): Prisma.TaskWhereInput {
  const tomorrowUtcMidnight = new Date(Date.parse(`${todayYmd}T00:00:00.000Z`) + 24 * 60 * 60 * 1000);
  return {
    source: DUE_REMINDER_SOURCE,
    status: { not: "COMPLETED" },
    dueDate: { not: null, lt: tomorrowUtcMidnight },
  };
}

/** 保存済み dueDate（UTC 0:00 = 暦日）から "YYYY-MM-DD" を取り出す。 */
function dueYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** JST 今日から見た超過日数（0 = 当日、1以上 = 超過）。 */
function overdueDays(due: Date, todayYmd: string): number {
  const dueMs = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const todayMs = Date.parse(`${todayYmd}T00:00:00.000Z`);
  return Math.round((todayMs - dueMs) / (24 * 60 * 60 * 1000));
}

export type DueReminderSummary = {
  mode: "EXECUTE" | "DRY-RUN";
  jstToday: string;
  source: string;
  total: number;
  dueToday: number;
  overdue: number;
  listed: number; // 本文に列挙した件数
  truncated: number; // 「他N件」に畳んだ件数
  mentioned: number; // メンションした担当者数（lineworksId あり）
  byAssignee: { assignee: string; hasLineworksId: boolean; count: number }[];
  items: {
    taskId: string;
    title: string;
    candidateName: string | null;
    dueDate: string;
    overdueDays: number;
    assignee: string | null;
  }[];
  sent: boolean;
  error?: string;
  durationMs: number;
};

/**
 * 期日当日・期日超過の AI起票タスクを集計し、LINE WORKS へ1通にまとめて通知する。
 * 既定は DRY-RUN（送信せず対象と内訳だけ返す）。対象0件なら何も送らない。
 */
export async function runDueReminder(opts?: {
  execute?: boolean;
  today?: string; // テスト用。既定は JST 今日
  maxItems?: number;
  log?: (msg: string) => void;
}): Promise<DueReminderSummary> {
  const execute = opts?.execute ?? false;
  const todayYmd = opts?.today ?? jstYmd();
  const maxItems = opts?.maxItems ?? DUE_REMINDER_MAX_ITEMS;
  const log = opts?.log ?? (() => {});
  const startedAt = Date.now();

  const tasks = await prisma.task.findMany({
    where: buildDueReminderWhere(todayYmd),
    select: {
      id: true,
      title: true,
      dueDate: true,
      candidate: { select: { name: true } },
      assignees: {
        select: { employee: { select: { name: true, user: { select: { lineworksId: true } } } } },
      },
    },
    orderBy: { dueDate: "asc" }, // 超過が長いものから
  });

  const items: DueReminderSummary["items"] = tasks.map((t) => ({
    taskId: t.id,
    title: t.title,
    candidateName: t.candidate?.name ?? null,
    dueDate: dueYmd(t.dueDate as Date),
    overdueDays: overdueDays(t.dueDate as Date, todayYmd),
    assignee: t.assignees[0]?.employee?.name ?? null,
  }));

  // 担当者別内訳（Actions ログで誰に何件出ているかを見るため）
  const byAssigneeMap = new Map<string, { hasLineworksId: boolean; count: number }>();
  const lineworksIds = new Set<string>();
  const assigneeNames = new Set<string>();
  for (const t of tasks) {
    for (const a of t.assignees) {
      const name = a.employee?.name ?? "(未割り当て)";
      const lw = a.employee?.user?.lineworksId ?? null;
      if (lw) lineworksIds.add(lw);
      if (a.employee?.name) assigneeNames.add(a.employee.name);
      const cur = byAssigneeMap.get(name) ?? { hasLineworksId: !!lw, count: 0 };
      cur.count += 1;
      cur.hasLineworksId = cur.hasLineworksId || !!lw;
      byAssigneeMap.set(name, cur);
    }
  }

  const dueToday = items.filter((i) => i.overdueDays <= 0).length;
  const overdue = items.filter((i) => i.overdueDays > 0).length;
  const listed = Math.min(items.length, maxItems);

  const summary: DueReminderSummary = {
    mode: execute ? "EXECUTE" : "DRY-RUN",
    jstToday: todayYmd,
    source: DUE_REMINDER_SOURCE,
    total: items.length,
    dueToday,
    overdue,
    listed,
    truncated: Math.max(0, items.length - listed),
    mentioned: lineworksIds.size,
    byAssignee: [...byAssigneeMap.entries()].map(([assignee, v]) => ({
      assignee,
      hasLineworksId: v.hasLineworksId,
      count: v.count,
    })),
    items,
    sent: false,
    durationMs: 0,
  };

  log(
    `[t150-due-reminder] ${summary.mode} jstToday=${todayYmd} source=${DUE_REMINDER_SOURCE} ` +
      `total=${summary.total}（当日=${dueToday} 超過=${overdue}）`,
  );

  if (items.length === 0) {
    summary.durationMs = Date.now() - startedAt;
    log("[t150-due-reminder] 対象0件のため通知しない");
    return summary;
  }

  if (execute) {
    try {
      await notifyAiTaskDueReminder({
        jstToday: todayYmd,
        items: items.slice(0, maxItems) as DueReminderItem[],
        truncated: summary.truncated,
        assigneeNames: [...assigneeNames],
        assigneeLineworksIds: [...lineworksIds],
      });
      summary.sent = true;
      log(`[t150-due-reminder] 通知送信 完了（列挙${listed}件 / 畳み${summary.truncated}件）`);
    } catch (e) {
      summary.error = e instanceof Error ? e.message : String(e);
      log(`[t150-due-reminder] 通知送信 失敗: ${summary.error}`);
    }
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

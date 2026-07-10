// T-139: 日程調整タスク外部API（GET一覧 / PATCH更新）の共有ロジック。
// 日程調整AIエージェント（外部RPA機）が夜間ポーリングで読み書きするための受け口。
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** 日程調整タスクを識別するカテゴリ名（TaskCategory.name）。 */
export const SCHEDULE_CATEGORY_NAME = "日程調整";

/** レスポンス fields に必ず含める TaskTemplateField.label。値が無いキーは null。 */
export const SCHEDULE_FIELD_LABELS = ["希望日時", "面談形式", "備考"] as const;

/** Task.status の許可値（Prisma enum TaskStatus と一致）。 */
export const VALID_TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;

/** AIが書いたコメントを人間の目で判別するための接頭辞。 */
export const AI_COMMENT_PREFIX = "【日程調整AI】";

/** 外部API認証: x-api-secret を EXTERNAL_API_SECRET と照合（create-schedule-task と同一）。 */
export function isAuthorizedExternal(request: Request): boolean {
  const secret = request.headers.get("x-api-secret");
  const expected = process.env.EXTERNAL_API_SECRET;
  return Boolean(expected) && secret === expected;
}

/**
 * コメント作者のシステムユーザーIDを解決する（TaskComment.userId が必須のため）。
 * 既存の外部連携（bookmarks/from-job-platform 等）と同じ anonymous@local → admin フォールバック。
 */
export async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" }, select: { id: true } });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, select: { id: true } });
  return admin?.id ?? null;
}

/** GET/PATCH 共通の Prisma include（担当者・フィールド値）。 */
export const scheduleTaskInclude = {
  assignees: { include: { employee: { select: { id: true, name: true } } } },
  fieldValues: { include: { field: { select: { label: true } } } },
} satisfies Prisma.TaskInclude;

type ScheduleTaskRow = Prisma.TaskGetPayload<{ include: typeof scheduleTaskInclude }>;

/**
 * DateTime(UTC instant) を JST(+09:00) の ISO 文字列で返す。
 * 罠#17回避: toISOString().slice() は使わず、+9h した UTC 各要素を +09:00 表記で組み立てる。
 */
export function toJstIso(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}` +
    `T${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}:${p(jst.getUTCSeconds())}+09:00`
  );
}

/**
 * ISO文字列を Date(UTC instant) に変換する。タイムゾーン指定が無ければ JST(+09:00) とみなす。
 * 不正な値は null。createdAt(UTC保存) との gte/lte 比較にそのまま使える。
 */
export function parseJstDefaultDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const hasTz = /([zZ])$|([+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasTz ? s : `${s}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** RPA機へ返すタスク表現（GET/PATCH 共通形状）。 */
export type SerializedScheduleTask = {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string; // JST +09:00
  fields: Record<string, string | null>;
  assignees: { id: string; name: string }[];
  candidateId: string | null;
};

/** Task 行を RPA機向けJSON形状へ変換する。fields は生テキストを加工せず、無いキーは null。 */
export function serializeScheduleTask(task: ScheduleTaskRow): SerializedScheduleTask {
  const byLabel = new Map<string, string>();
  for (const fv of task.fieldValues) {
    if (fv.field?.label) byLabel.set(fv.field.label, fv.value);
  }
  const fields: Record<string, string | null> = {};
  for (const label of SCHEDULE_FIELD_LABELS) {
    fields[label] = byLabel.has(label) ? byLabel.get(label)! : null;
  }
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    createdAt: toJstIso(task.createdAt),
    fields,
    assignees: task.assignees.map((a) => ({ id: a.employee.id, name: a.employee.name })),
    candidateId: task.candidateId ?? null,
  };
}

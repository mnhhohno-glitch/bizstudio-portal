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

/**
 * T-177: 外部API（RPA）から来た status を、実際にDBへ保存する値へ読み替える。
 *
 * RPA は返信を送り終えた時点で COMPLETED を送ってくるが、「AIが返信を送った」≠「面談日程が確定した」。
 * 完了にすると一覧API（/api/tasks）が includeCompleted 未指定時に無条件で除外するため、
 * 事務担当から見てタスクが黙って消える。人が中身を確認してから完了にする運用に合わせ、
 * **COMPLETED は IN_PROGRESS（対応中）へ読み替えて保存する**。
 *
 * NOT_STARTED / IN_PROGRESS はそのまま。画面からの完了操作（/api/tasks/[taskId]/status）は
 * この読み替えの対象外＝人手では従来どおり COMPLETED にできる。
 */
export function resolveStoredStatus(requested: TaskStatus): TaskStatus {
  return requested === "COMPLETED" ? "IN_PROGRESS" : requested;
}

/** AIが書いたコメントを人間の目で判別するための接頭辞。 */
export const AI_COMMENT_PREFIX = "【日程調整AI】";

/** 対象外コメント判定キーワード。コメント本文にこの文字列を含めばRPA再処理対象外。 */
export const SCHEDULE_EXEMPT_COMMENT_MARKER =
  process.env.SCHEDULE_EXEMPT_COMMENT_MARKER || "自動対応対象外";

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
  hasExemptComment: boolean;
  /**
   * T-177: このタスクに【日程調整AI】コメント（AI_COMMENT_PREFIX）が1件でもあるか。
   * AIが完了化しなくなった結果、返信済みのタスクも「対応中」でポーリング対象に残り続けるため、
   * RPA側が再処理をスキップする判定に使う。hasExemptComment（人手の対象外指定）とは用途が別。
   */
  hasAiReplyComment: boolean;
};

/** Task 行を RPA機向けJSON形状へ変換する。fields は生テキストを加工せず、無いキーは null。 */
export function serializeScheduleTask(
  task: ScheduleTaskRow,
  opts?: { hasExemptComment?: boolean; hasAiReplyComment?: boolean },
): SerializedScheduleTask {
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
    hasExemptComment: opts?.hasExemptComment ?? false,
    hasAiReplyComment: opts?.hasAiReplyComment ?? false,
  };
}

/** T-177: 1タスク分のコメント由来フラグ。 */
export type ScheduleCommentFlags = {
  hasExemptComment: boolean;
  hasAiReplyComment: boolean;
};

/** 両フラグ false の既定値（クエリに現れなかった taskId 用）。 */
export const EMPTY_SCHEDULE_COMMENT_FLAGS: ScheduleCommentFlags = {
  hasExemptComment: false,
  hasAiReplyComment: false,
};

/**
 * T-177: 複数タスクぶんの「対象外コメント有無」「AI返信コメント有無」を1クエリでまとめて引く。
 * GET一覧 / PATCH単体の両方から使う（判定ロジックを2箇所に散らさないため）。
 * 返り値に現れない taskId は EMPTY_SCHEDULE_COMMENT_FLAGS 扱い。
 */
export async function loadScheduleCommentFlags(
  taskIds: string[],
): Promise<Map<string, ScheduleCommentFlags>> {
  const flags = new Map<string, ScheduleCommentFlags>();
  if (taskIds.length === 0) return flags;

  const comments = await prisma.taskComment.findMany({
    where: {
      taskId: { in: taskIds },
      OR: [
        { content: { contains: SCHEDULE_EXEMPT_COMMENT_MARKER } },
        { content: { contains: AI_COMMENT_PREFIX } },
      ],
    },
    select: { taskId: true, content: true },
  });

  for (const c of comments) {
    const cur = flags.get(c.taskId) ?? { ...EMPTY_SCHEDULE_COMMENT_FLAGS };
    if (c.content.includes(SCHEDULE_EXEMPT_COMMENT_MARKER)) cur.hasExemptComment = true;
    if (c.content.includes(AI_COMMENT_PREFIX)) cur.hasAiReplyComment = true;
    flags.set(c.taskId, cur);
  }
  return flags;
}

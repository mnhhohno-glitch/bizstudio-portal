// T-151 Phase 2-2: AI が検出したタスク候補から Task を起票する共通ロジック。
//
// T-150（AIアドバイザー会話経由）と T-151（面談ログ解析経由）の両方から呼ぶ。
// 元は suggested-tasks/route.ts（advisor 側）にインラインで書かれていたものを、
// カテゴリID・必須フィールド埋め・upsert 条件が経路ごとに二重定義されるのを防ぐために切り出した。
// ★振る舞いは移設前と一切変えていない（Phase 2-2 は純粋なリファクタリング）。
//
// ★最重要: upsert は必ず source="AI_ADVISOR" + sourceKind で絞る。
//   タイトル前方一致で既存タスクを探すと、CA が同じ書式で手動作成したタスクを
//   掴んで上書きする（既存 createOrUpdateResponseTask に前例あり＝罠#30 と同型）。
//   source が NULL の手動タスクは検索対象にも更新対象にもしない。
//
// ★source は経路で分けない（T-151 で確定）。「1求職者×1種別=未完了1件」は経路をまたいで
//   成立すべきで、分けると部分ユニークインデックス tasks_ai_advisor_one_open_per_kind が
//   面談起票分を対象にせず、同じ約束のタスクが2件立つ。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUGGESTED_TASK_KINDS, type SuggestedTaskKind } from "@/lib/advisor/suggested-tasks";
import { notifyAiTaskCreated } from "@/lib/task-notification";

/** AI 起票タスクの source（経路で分けない）。 */
export const AI_TASK_SOURCE = "AI_ADVISOR";

/** 種別ごとの起票内容。カテゴリ「日程調整」は絶対に使わない
 *  （external/schedule-tasks がカテゴリ名で findMany するため、日程調整AI/RPA に拾われる）。 */
export const KIND_CONFIG: Record<
  SuggestedTaskKind,
  { categoryId: string; label: string; title: (name: string) => string }
> = {
  JOB_SEARCH_SEND: {
    categoryId: "cmmvzf6ct001m1doafno6y037", // 求人検索（既存・求職者対応グループ）
    label: "求人検索・送付",
    title: (name) => `【求人検索】${name}さんへ求人送付`,
  },
  FORM_SURVEY: {
    categoryId: "cmsaluhq00001w8d6irm5omcs", // アンケート対応（T-150 で新設・求職者対応グループ）
    label: "アンケート送付・回答確認",
    title: (name) => `【アンケート】${name}さんへフォーム送付・回答確認`,
  },
};

/** "YYYY-MM-DD" のみ受け付ける。時刻付き・不正形式は拒否する。 */
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * カテゴリの必須テンプレートフィールドに入れる既定値。
 * AI は職種等を出力しないため、必須フィールドが空のままだと詳細画面で空欄になる。
 * 「AI が起票したので未入力」であることが CA に伝わる固定文字を入れておく。
 * ラベル名（「職種」等）はハードコードせず is_required で動的に拾う（将来フィールドが増えても効くように）。
 * 先例: src/lib/schedule-agent/post-reserve.ts が「その他」カテゴリの必須フィールドに本文を格納している。
 */
const REQUIRED_FIELD_PLACEHOLDER = "AIアドバイザー起票";

/** 起票元の経路。description の書き分けにのみ使う（source カラムには入れない）。 */
export type AiTaskOrigin = "advisor" | "interview";

const ORIGIN_DESCRIPTION: Record<AiTaskOrigin, string> = {
  advisor: "AIアドバイザーとの会話から自動起票（内容はCAが確認済み）",
  interview: "面談ログの解析から自動起票（内容はCAが確認済み）",
};

export type CreateAiTaskParams = {
  candidateId: string;
  kind: SuggestedTaskKind;
  /** "YYYY-MM-DD"。バリデーション済みの文字列を渡すこと（validateAiTaskInput を使う）。 */
  dueDateStr: string;
  origin: AiTaskOrigin;
  /** 操作中のCA。createdByUserId になる。 */
  actor: { id: string; name?: string | null };
};

export type CreateAiTaskResult =
  | { ok: true; taskId: string; created: boolean; dueDate: string }
  | { ok: false; error: string; status: number };

/**
 * kind / dueDate の入力検証。経路を問わず同じ条件で弾く。
 * 戻り値が null なら検証OK。
 */
export function validateAiTaskInput(
  kind: unknown,
  dueDate: unknown,
): { error: string; status: number } | null {
  if (!SUGGESTED_TASK_KINDS.includes(kind as SuggestedTaskKind)) {
    return { error: "kind が不正です", status: 400 };
  }
  const s = typeof dueDate === "string" ? dueDate.trim() : "";
  if (!YMD_RE.test(s)) {
    return { error: "dueDate は YYYY-MM-DD 形式で指定してください", status: 400 };
  }
  if (Number.isNaN(new Date(s).getTime())) {
    return { error: "dueDate が不正です", status: 400 };
  }
  return null;
}

/**
 * AI 起票タスクを upsert する。
 *
 * - 同一求職者×同一種別の未完了 AI起票タスクが既にあれば **期日のみ更新**（created=false）。
 *   title / description / assignees は触らない＝CA が手を入れた内容を保持する。
 * - 新規作成時のみ担当者割り当て・必須フィールド埋め・LINE WORKS 通知を行う。
 * - 破棄フラグ（advisor_chat_messages / interview_records）は呼び出し側の責務。
 */
export async function createAiTask(params: CreateAiTaskParams): Promise<CreateAiTaskResult> {
  const { candidateId, kind, dueDateStr, origin, actor } = params;

  // 罠#17: "YYYY-MM-DD" をそのまま new Date() に渡すと UTC 0:00 になる。
  // これが既存タスク（1,217件・66.9%）と同じ形式。"+09:00" を付けたり toISOString() を挟むと
  // 9時間ずれた値が入り、一覧のソート・期日判定が既存分と混ざる。
  const dueDate = new Date(dueDateStr);

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      name: true,
      employee: {
        select: { id: true, name: true, user: { select: { id: true, lineworksId: true } } },
      },
    },
  });
  if (!candidate) return { ok: false, error: "求職者が見つかりません", status: 404 };

  const config = KIND_CONFIG[kind];

  // ★手動タスク（source=NULL）は検索対象にしない。種別は専用カラムで絞る。
  const existing = await prisma.task.findFirst({
    where: {
      candidateId,
      source: AI_TASK_SOURCE,
      sourceKind: kind,
      status: { not: "COMPLETED" },
    },
    select: { id: true },
  });

  let taskId: string;
  let created = false;

  if (existing) {
    // 既存の AI起票タスクは期日のみ更新（title / description / assignees は触らない）
    await prisma.task.update({ where: { id: existing.id }, data: { dueDate } });
    taskId = existing.id;
  } else {
    // 担当CA を assignee にする。未設定なら操作者にフォールバック
    // （mypage-response-sync のように「担当CA無しならスキップ」にすると約束が消えるため）。
    const assigneeEmployeeId = candidate.employee?.id ?? null;
    const fallbackEmployee = assigneeEmployeeId
      ? null
      : await prisma.employee.findFirst({ where: { userId: actor.id }, select: { id: true } });
    const employeeId = assigneeEmployeeId ?? fallbackEmployee?.id ?? null;

    // 必須テンプレートフィールドを既定値で埋める（新規作成時のみ）。
    // 既存タスクの期日更新時は触らない＝CAが後から入力した値を上書きしない。
    // 必須フィールドが0件のカテゴリ（例: アンケート対応）では空配列になり、何も作らない。
    const requiredFields = await prisma.taskTemplateField.findMany({
      where: { categoryId: config.categoryId, isRequired: true },
      select: { id: true },
    });

    try {
      const task = await prisma.task.create({
        data: {
          title: config.title(candidate.name),
          description: ORIGIN_DESCRIPTION[origin],
          categoryId: config.categoryId,
          candidateId,
          status: "NOT_STARTED",
          priority: "MEDIUM",
          dueDate,
          createdByUserId: actor.id,
          completionType: "any",
          source: AI_TASK_SOURCE,
          sourceKind: kind,
          ...(employeeId ? { assignees: { create: [{ employeeId }] } } : {}),
          ...(requiredFields.length > 0
            ? {
                fieldValues: {
                  create: requiredFields.map((f) => ({
                    fieldId: f.id,
                    value: REQUIRED_FIELD_PLACEHOLDER,
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });
      taskId = task.id;
      created = true;
    } catch (e) {
      // 連打などの競合で部分ユニークインデックス（tasks_ai_advisor_one_open_per_kind）に
      // 引っかかった場合は、既に同じタスクがある＝CAから見れば成功。エラーを出さない。
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const raced = await prisma.task.findFirst({
          where: { candidateId, source: AI_TASK_SOURCE, sourceKind: kind, status: { not: "COMPLETED" } },
          select: { id: true },
        });
        if (!raced) throw e;
        await prisma.task.update({ where: { id: raced.id }, data: { dueDate } });
        taskId = raced.id;
      } else {
        throw e;
      }
    }
  }

  // 通知は失敗してもタスク作成を成功扱いにする（既存の tasks/route.ts と同じ方針）。
  if (created) {
    try {
      await notifyAiTaskCreated({
        taskId,
        title: config.title(candidate.name),
        categoryLabel: config.label,
        candidateName: candidate.name,
        assigneeName: candidate.employee?.name ?? actor.name ?? null,
        assigneeLineworksId: candidate.employee?.user?.lineworksId ?? null,
        dueDate,
        actorName: actor.name ?? "不明",
      });
    } catch (e) {
      console.error("[ai-task-create] LINE WORKS 通知に失敗（タスク作成は成功）:", e);
    }
  }

  console.log(
    `[ai-task-create] ${created ? "created" : "updated"} origin=${origin} taskId=${taskId} kind=${kind} due=${dueDateStr} candidate=${candidateId}`,
  );

  return { ok: true, taskId, created, dueDate: dueDateStr };
}

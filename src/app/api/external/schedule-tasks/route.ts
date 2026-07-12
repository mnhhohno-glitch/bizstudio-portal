// T-139 Task1: GET /api/external/schedule-tasks
// 日程調整AIエージェント（外部RPA機・夜間ポーリング）向けの、カテゴリ「日程調整」タスク取得API。
// 認証: x-api-secret = EXTERNAL_API_SECRET（create-schedule-task と同一）。
import { NextResponse } from "next/server";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SCHEDULE_CATEGORY_NAME,
  VALID_TASK_STATUSES,
  isAuthorizedExternal,
  parseJstDefaultDate,
  scheduleTaskInclude,
  serializeScheduleTask,
} from "@/lib/schedule-tasks";
import { extractCandidateName } from "@/lib/schedule-agent/parse-preferences";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: Request) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;

  // status: カンマ区切り複数可。未指定なら全status。許可外の値が混ざれば 400。
  let statuses: TaskStatus[] = [];
  const statusRaw = (sp.get("status") ?? "").trim();
  if (statusRaw) {
    const parts = statusRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = parts.filter((p) => !VALID_TASK_STATUSES.includes(p as (typeof VALID_TASK_STATUSES)[number]));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `無効なstatus: ${invalid.join(", ")}（許可値: ${VALID_TASK_STATUSES.join(", ")}）` },
        { status: 400 },
      );
    }
    statuses = parts as TaskStatus[];
  }

  // createdAfter / createdBefore: TZ無しは JST(+09:00) とみなす。不正は 400。
  const createdAfterRaw = sp.get("createdAfter");
  const createdBeforeRaw = sp.get("createdBefore");
  const createdAfter = parseJstDefaultDate(createdAfterRaw);
  const createdBefore = parseJstDefaultDate(createdBeforeRaw);
  if (createdAfterRaw && !createdAfter) {
    return NextResponse.json({ error: "createdAfter が不正な日時形式です" }, { status: 400 });
  }
  if (createdBeforeRaw && !createdBefore) {
    return NextResponse.json({ error: "createdBefore が不正な日時形式です" }, { status: 400 });
  }

  // limit: 既定100・最大500。
  let limit = DEFAULT_LIMIT;
  const limitRaw = sp.get("limit");
  if (limitRaw != null && limitRaw.trim() !== "") {
    const n = parseInt(limitRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "limit は正の整数で指定してください" }, { status: 400 });
    }
    limit = Math.min(n, MAX_LIMIT);
  }

  const createdAtFilter: Prisma.DateTimeFilter = {};
  if (createdAfter) createdAtFilter.gte = createdAfter;
  if (createdBefore) createdAtFilter.lte = createdBefore;

  const where: Prisma.TaskWhereInput = {
    // 固定フィルタ: カテゴリ「日程調整」のみ（他カテゴリは絶対に返さない）。
    category: { is: { name: SCHEDULE_CATEGORY_NAME } },
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(createdAfter || createdBefore ? { createdAt: createdAtFilter } : {}),
  };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
    include: scheduleTaskInclude,
  });

  // T-139 step4: 任意 dedupeByName=true。タイトルから抽出した氏名が同一のタスクが複数あれば
  // createdAt 最新の1件のみ返す（「同一氏名の重複は最新のみ処理対象」に対応）。
  // 既定（未指定）は従来どおり全件返す＝レスポンス形状も含め後方互換。
  if (sp.get("dedupeByName") === "true") {
    const latestByName = new Map<string, (typeof tasks)[number]>();
    const passthrough: typeof tasks = [];

    for (const t of tasks) {
      const name = extractCandidateName(t.title);
      if (!name) {
        passthrough.push(t); // 氏名を抽出できないものは重複判定の対象外（そのまま返す）
        continue;
      }
      const prev = latestByName.get(name);
      // tasks は createdAt 昇順。後勝ちで最新が残る。
      if (!prev || t.createdAt >= prev.createdAt) latestByName.set(name, t);
    }

    const deduped = [...passthrough, ...latestByName.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    return NextResponse.json({ tasks: deduped.map(serializeScheduleTask) });
  }

  return NextResponse.json({ tasks: tasks.map(serializeScheduleTask) });
}

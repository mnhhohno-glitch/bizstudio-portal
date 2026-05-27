import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { createTask, updateTask, completeTask } from "@/lib/googleTasks";

type Slot = "first" | "second" | "final";
type Action = "create" | "update" | "complete";

const SLOT_LABEL: Record<Slot, string> = {
  first: "一次面接",
  second: "二次面接",
  final: "最終面接",
};

function isSlot(v: unknown): v is Slot {
  return v === "first" || v === "second" || v === "final";
}

function isAction(v: unknown): v is Action {
  return v === "create" || v === "update" || v === "complete";
}

// JST 9時間ずれ罠回避: toLocaleDateString('sv-SE') 経由で YYYY-MM-DD 化
function toJstDateString(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { entryId } = await params;
  let body: { slot?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { slot, action } = body;
  if (!isSlot(slot)) {
    return NextResponse.json(
      { error: "slot must be 'first' | 'second' | 'final'" },
      { status: 400 }
    );
  }
  if (!isAction(action)) {
    return NextResponse.json(
      { error: "action must be 'create' | 'update' | 'complete'" },
      { status: 400 }
    );
  }

  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ skipped: true, reason: "not_connected" });
  }

  const entry = await prisma.jobEntry.findUnique({
    where: { id: entryId },
    include: {
      candidate: { select: { id: true, name: true } },
    },
  });
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dateCol =
    slot === "first"
      ? entry.firstInterviewDate
      : slot === "second"
        ? entry.secondInterviewDate
        : entry.finalInterviewDate;
  const timeCol =
    slot === "first"
      ? entry.firstInterviewTime
      : slot === "second"
        ? entry.secondInterviewTime
        : entry.finalInterviewTime;
  const gtaskId =
    slot === "first"
      ? entry.firstInterviewGtaskId
      : slot === "second"
        ? entry.secondInterviewGtaskId
        : entry.finalInterviewGtaskId;

  const buildSetField = (value: string | null) =>
    slot === "first"
      ? { firstInterviewGtaskId: value }
      : slot === "second"
        ? { secondInterviewGtaskId: value }
        : { finalInterviewGtaskId: value };

  // 共通: title 生成
  const buildTitle = (date: Date, time: string): string => {
    const normalizedTime = time.length === 4 ? `0${time}` : time;
    return `${entry.companyName}_${entry.candidate.name} ${SLOT_LABEL[slot]}${normalizedTime}`;
  };

  // 解決後の action（フォールバック適用後）
  let resolvedAction: Action = action;

  // create/update のフォールバック判定
  if (resolvedAction === "create" && gtaskId) {
    resolvedAction = "update";
  } else if (resolvedAction === "update" && !gtaskId) {
    if (dateCol && timeCol && /^\d{1,2}:\d{2}$/.test(timeCol)) {
      resolvedAction = "create";
    } else {
      return NextResponse.json({ skipped: true, reason: "no_task_to_update" });
    }
  } else if (resolvedAction === "update" && (!dateCol || !timeCol)) {
    // 日時が消えた → complete へ
    resolvedAction = "complete";
  }

  if (resolvedAction === "create") {
    if (!dateCol || !timeCol || !/^\d{1,2}:\d{2}$/.test(timeCol)) {
      return NextResponse.json({ skipped: true, reason: "incomplete" });
    }
    const dateStr = toJstDateString(dateCol);
    const title = buildTitle(dateCol, timeCol);
    const result = await createTask(user.id, { title, due: dateStr });
    if (!result.ok) {
      const status = result.reason === "scope_insufficient" || result.reason === "api_disabled" ? 403 : 500;
      return NextResponse.json({ success: false, error: result.reason, message: result.message }, { status });
    }
    await prisma.jobEntry.update({
      where: { id: entryId },
      data: buildSetField(result.value),
    });
    return NextResponse.json({ success: true, action: "created", taskId: result.value });
  }

  if (resolvedAction === "update") {
    if (!gtaskId) {
      return NextResponse.json({ skipped: true, reason: "no_task" });
    }
    if (!dateCol || !timeCol || !/^\d{1,2}:\d{2}$/.test(timeCol)) {
      return NextResponse.json({ skipped: true, reason: "incomplete" });
    }
    const dateStr = toJstDateString(dateCol);
    const title = buildTitle(dateCol, timeCol);
    const result = await updateTask(user.id, gtaskId, { title, due: dateStr });
    if (!result.ok) {
      const status = result.reason === "scope_insufficient" || result.reason === "api_disabled" ? 403 : 500;
      return NextResponse.json({ success: false, error: result.reason, message: result.message }, { status });
    }
    return NextResponse.json({ success: true, action: "updated", taskId: gtaskId });
  }

  // complete
  if (!gtaskId) {
    return NextResponse.json({ skipped: true, reason: "no_task" });
  }
  const result = await completeTask(user.id, gtaskId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.reason }, { status: result.reason === "scope_insufficient" ? 403 : 500 });
  }
  await prisma.jobEntry.update({
    where: { id: entryId },
    data: buildSetField(null),
  });
  return NextResponse.json({ success: true, action: "completed", taskId: gtaskId });
}

export const dynamic = "force-dynamic";

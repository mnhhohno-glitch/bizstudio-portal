import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { createTask, updateTask, completeTask } from "@/lib/googleTasks";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";

type Slot = "first" | "second" | "final" | "offer" | "prep";
type Action = "create" | "update" | "complete";

const SLOT_LABEL: Record<Slot, string> = {
  first: "一次面接",
  second: "二次面接",
  final: "最終面接",
  offer: "オファー面談",
  prep: "面接対策",
};

const SLOTS: Slot[] = ["first", "second", "final", "offer", "prep"];
function isSlot(v: unknown): v is Slot {
  return typeof v === "string" && (SLOTS as string[]).includes(v);
}

// slot ごとの JobEntry 列名（date/time/gtask/gcal）。一次/二次/最終と全く同じ追跡パターン。
const SLOT_FIELDS: Record<Slot, { dateK: string; timeK: string; gtaskK: string; gcalK: string }> = {
  first: { dateK: "firstInterviewDate", timeK: "firstInterviewTime", gtaskK: "firstInterviewGtaskId", gcalK: "firstInterviewGcalId" },
  second: { dateK: "secondInterviewDate", timeK: "secondInterviewTime", gtaskK: "secondInterviewGtaskId", gcalK: "secondInterviewGcalId" },
  final: { dateK: "finalInterviewDate", timeK: "finalInterviewTime", gtaskK: "finalInterviewGtaskId", gcalK: "finalInterviewGcalId" },
  offer: { dateK: "offerMeetingDate", timeK: "offerMeetingTime", gtaskK: "offerMeetingGtaskId", gcalK: "offerMeetingGcalId" },
  prep: { dateK: "interviewPrepDate", timeK: "interviewPrepTime", gtaskK: "interviewPrepGtaskId", gcalK: "interviewPrepGcalId" },
};

function isAction(v: unknown): v is Action {
  return v === "create" || v === "update" || v === "complete";
}

// JST 9時間ずれ罠回避: toLocaleDateString('sv-SE') 経由で YYYY-MM-DD 化
function toJstDateString(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// "H:mm" / "HH:mm" を "HH:mm" に正規化
function normalizeTime(time: string): string {
  return time.length === 4 ? `0${time}` : time;
}

// 開始時刻に 60分加算した終了時刻を返す。24時超は 23:59 で頭打ち（日跨ぎさせない）
function addOneHourCapped(time: string): string {
  const [h, m] = normalizeTime(time).split(":").map(Number);
  let endH = h + 1;
  let endM = m;
  if (endH >= 24) {
    endH = 23;
    endM = 59;
  }
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
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
      { error: "slot must be 'first' | 'second' | 'final' | 'offer' | 'prep'" },
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

  const fk = SLOT_FIELDS[slot];
  const er = entry as unknown as Record<string, Date | string | null>;
  const dateCol = er[fk.dateK] as Date | null;
  const timeCol = er[fk.timeK] as string | null;
  const gtaskId = er[fk.gtaskK] as string | null;
  const gcalId = er[fk.gcalK] as string | null;

  // gtask / gcal の更新フィールドをまとめて生成（成功した分だけ書き込む）
  const gtaskField = (value: string | null) => ({ [fk.gtaskK]: value });
  const gcalField = (value: string | null) => ({ [fk.gcalK]: value });

  // タスクタイトル: {企業名}_{求職者名} {ラベル}{HH:MM}
  const buildTaskTitle = (time: string): string =>
    `${entry.companyName}_${entry.candidate.name} ${SLOT_LABEL[slot]}${normalizeTime(time)}`;

  // カレンダー予定タイトル: [一次面接] {求職者氏名} / {企業名}
  const eventSummary = `[${SLOT_LABEL[slot]}] ${entry.candidate.name} / ${entry.companyName}`;

  // 解決後の action（フォールバック適用後）。判定は従来どおり gtaskId 基準（ダイアログが算定済）
  let resolvedAction: Action = action;

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

  // ===== create / update（日時が揃っている） =====
  if (resolvedAction === "create" || resolvedAction === "update") {
    if (!dateCol || !timeCol || !/^\d{1,2}:\d{2}$/.test(timeCol)) {
      return NextResponse.json({ skipped: true, reason: "incomplete" });
    }
    const dateStr = toJstDateString(dateCol);
    const startTime = normalizeTime(timeCol);
    const endTime = addOneHourCapped(timeCol);
    const taskTitle = buildTaskTitle(timeCol);

    // --- タスク（gtaskId 有無で create/update を分岐）---
    let taskOk = false;
    let taskReason: string | null = null;
    let taskMessage: string | null = null;
    let newTaskId: string | null = gtaskId;
    if (gtaskId) {
      const r = await updateTask(user.id, gtaskId, { title: taskTitle, due: dateStr });
      taskOk = r.ok;
      if (!r.ok) {
        taskReason = r.reason;
        taskMessage = r.message ?? null;
      }
    } else {
      const r = await createTask(user.id, { title: taskTitle, due: dateStr });
      taskOk = r.ok;
      if (r.ok) newTaskId = r.value;
      else {
        taskReason = r.reason;
        taskMessage = r.message ?? null;
      }
    }

    // --- カレンダー予定（gcalId 有無で create/update を分岐）---
    let calOk = false;
    let newGcalId: string | null = gcalId;
    if (gcalId) {
      // updateCalendarEvent は void。例外時は内部で握りつぶし → 成功扱いとみなす
      await updateCalendarEvent(user.id, gcalId, dateStr, {
        summary: eventSummary,
        startTime,
        endTime,
      });
      calOk = true;
    } else {
      const eventId = await createCalendarEvent(user.id, dateStr, {
        summary: eventSummary,
        startTime,
        endTime,
      });
      if (eventId) {
        newGcalId = eventId;
        calOk = true;
      }
    }

    // --- 成功した分を DB に保存 ---
    const data: Record<string, string | null> = {};
    if (taskOk) Object.assign(data, gtaskField(newTaskId));
    if (calOk) Object.assign(data, gcalField(newGcalId));
    if (Object.keys(data).length > 0) {
      await prisma.jobEntry.update({ where: { id: entryId }, data });
    }

    return buildSyncResponse({
      actionLabel: gtaskId || gcalId ? "updated" : "created",
      taskOk,
      taskReason,
      taskMessage,
      taskId: taskOk ? newTaskId : undefined,
      calOk,
      eventId: calOk ? newGcalId : undefined,
    });
  }

  // ===== complete（日時消去 / 選考終了フラグ）=====
  // タスク完了 + カレンダー予定削除。どちらも対象が無ければスキップ
  if (!gtaskId && !gcalId) {
    return NextResponse.json({ skipped: true, reason: "no_task" });
  }

  let taskOk = !gtaskId; // 対象が無ければ「処理不要=成功」扱い
  let taskReason: string | null = null;
  if (gtaskId) {
    const r = await completeTask(user.id, gtaskId);
    taskOk = r.ok;
    if (!r.ok) taskReason = r.reason;
  }

  let calOk = !gcalId;
  if (gcalId) {
    // deleteCalendarEvent は void。404 等は内部で握りつぶし → 成功扱い
    await deleteCalendarEvent(user.id, gcalId);
    calOk = true;
  }

  const data: Record<string, string | null> = {};
  if (taskOk && gtaskId) Object.assign(data, gtaskField(null));
  if (calOk && gcalId) Object.assign(data, gcalField(null));
  if (Object.keys(data).length > 0) {
    await prisma.jobEntry.update({ where: { id: entryId }, data });
  }

  return buildSyncResponse({
    actionLabel: "completed",
    taskOk,
    taskReason,
    taskMessage: null,
    taskId: undefined,
    calOk,
    eventId: undefined,
  });
}

// フェイルソフト レスポンス生成
function buildSyncResponse(opts: {
  actionLabel: string;
  taskOk: boolean;
  taskReason: string | null;
  taskMessage: string | null;
  taskId?: string | null;
  calOk: boolean;
  eventId?: string | null;
}) {
  const { actionLabel, taskOk, taskReason, taskMessage, taskId, calOk, eventId } = opts;

  // 両方成功
  if (taskOk && calOk) {
    return NextResponse.json({ success: true, action: actionLabel, taskId, eventId });
  }

  // タスクが scope 不足 / API 未有効 → 再認証導線（既存挙動を維持。403）
  if (!taskOk && (taskReason === "scope_insufficient" || taskReason === "api_disabled")) {
    return NextResponse.json(
      { success: false, error: taskReason, message: taskMessage, partial: calOk },
      { status: 403 }
    );
  }

  // 両方失敗
  if (!taskOk && !calOk) {
    return NextResponse.json(
      { success: false, error: taskReason || "sync_failed", message: taskMessage },
      { status: 500 }
    );
  }

  // 片方だけ失敗（フェイルソフト・200）
  return NextResponse.json({
    success: true,
    action: actionLabel,
    partial: true,
    failed: taskOk ? "calendar" : "task",
    taskId,
    eventId,
  });
}

export const dynamic = "force-dynamic";

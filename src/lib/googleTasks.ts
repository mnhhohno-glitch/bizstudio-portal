import { google } from "googleapis";
import { getAuthenticatedOAuth2Client } from "./googleCalendar";

// "YYYY-MM-DD" → "YYYY-MM-DDT00:00:00.000Z"
function toTaskDue(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

// Google Tasks API は scope 不足の場合 403 を返す。呼び出し側で再認証誘導するため
// この型で判別できるようにする。
export type TaskOpResult<T> = { ok: true; value: T } | { ok: false; reason: "not_connected" | "scope_insufficient" | "error" };

function isScopeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: number; status?: number; message?: string };
  if (e.code === 403 || e.status === 403) {
    const msg = (e.message || "").toLowerCase();
    return msg.includes("insufficient") || msg.includes("scope");
  }
  return false;
}

export async function createTask(
  userId: string,
  options: { title: string; due: string; notes?: string }
): Promise<TaskOpResult<string>> {
  const auth = await getAuthenticatedOAuth2Client(userId);
  if (!auth) return { ok: false, reason: "not_connected" };

  try {
    const tasksApi = google.tasks({ version: "v1", auth: auth.oauth2Client });
    const res = await tasksApi.tasks.insert({
      tasklist: "@default",
      requestBody: {
        title: options.title,
        due: toTaskDue(options.due),
        notes: options.notes || undefined,
      },
    });
    const id = res.data.id;
    if (!id) return { ok: false, reason: "error" };
    return { ok: true, value: id };
  } catch (error) {
    if (isScopeError(error)) {
      console.error("[GTasks] Scope insufficient on create:", error);
      return { ok: false, reason: "scope_insufficient" };
    }
    console.error("[GTasks] Create task failed:", error);
    return { ok: false, reason: "error" };
  }
}

export async function updateTask(
  userId: string,
  taskId: string,
  options: { title?: string; due?: string }
): Promise<TaskOpResult<true>> {
  const auth = await getAuthenticatedOAuth2Client(userId);
  if (!auth) return { ok: false, reason: "not_connected" };

  try {
    const tasksApi = google.tasks({ version: "v1", auth: auth.oauth2Client });
    const body: { title?: string; due?: string } = {};
    if (options.title !== undefined) body.title = options.title;
    if (options.due !== undefined) body.due = toTaskDue(options.due);

    await tasksApi.tasks.patch({
      tasklist: "@default",
      task: taskId,
      requestBody: body,
    });
    return { ok: true, value: true };
  } catch (error) {
    if (isScopeError(error)) {
      console.error("[GTasks] Scope insufficient on update:", error);
      return { ok: false, reason: "scope_insufficient" };
    }
    console.error("[GTasks] Update task failed:", error);
    return { ok: false, reason: "error" };
  }
}

export async function completeTask(
  userId: string,
  taskId: string
): Promise<TaskOpResult<true>> {
  const auth = await getAuthenticatedOAuth2Client(userId);
  if (!auth) return { ok: false, reason: "not_connected" };

  try {
    const tasksApi = google.tasks({ version: "v1", auth: auth.oauth2Client });
    await tasksApi.tasks.patch({
      tasklist: "@default",
      task: taskId,
      requestBody: { status: "completed" },
    });
    return { ok: true, value: true };
  } catch (error) {
    if (isScopeError(error)) {
      console.error("[GTasks] Scope insufficient on complete:", error);
      return { ok: false, reason: "scope_insufficient" };
    }
    // 404 はすでに完了/削除済み扱い
    const e = error as { code?: number };
    if (e?.code === 404) return { ok: true, value: true };
    console.error("[GTasks] Complete task failed:", error);
    return { ok: false, reason: "error" };
  }
}

import { google } from "googleapis";
import { getAuthenticatedOAuth2Client } from "./googleCalendar";

// "YYYY-MM-DD" → "YYYY-MM-DDT00:00:00.000Z"
function toTaskDue(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

// Google Tasks API のエラーを呼び出し側で判別するための分類。
// - scope_insufficient: 再認証で tasks スコープ付与が必要
// - api_disabled: Google Cloud Console で Tasks API を有効化する必要あり
// - error: その他
export type TaskFailureReason = "not_connected" | "scope_insufficient" | "api_disabled" | "error";
export type TaskOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: TaskFailureReason; message?: string };

function categorizeError(error: unknown): { reason: "scope_insufficient" | "api_disabled" | "error"; message?: string } {
  if (!error || typeof error !== "object") return { reason: "error" };
  const e = error as { code?: number; status?: number; message?: string };
  const msg = e.message || "";
  const lower = msg.toLowerCase();

  if (e.code === 403 || e.status === 403) {
    if (lower.includes("insufficient") || lower.includes("scope")) {
      return { reason: "scope_insufficient", message: msg };
    }
    // "Google Tasks API has not been used in project ... before or it is disabled."
    if (lower.includes("has not been used") || lower.includes("is disabled") || lower.includes("api has been disabled")) {
      return { reason: "api_disabled", message: msg };
    }
  }
  return { reason: "error", message: msg };
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
    const cat = categorizeError(error);
    console.error("[GTasks] Create task failed:", cat.reason, error);
    return { ok: false, reason: cat.reason, message: cat.message };
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
    const cat = categorizeError(error);
    console.error("[GTasks] Update task failed:", cat.reason, error);
    return { ok: false, reason: cat.reason, message: cat.message };
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
    // 404 はすでに完了/削除済み扱い
    const e = error as { code?: number };
    if (e?.code === 404) return { ok: true, value: true };
    const cat = categorizeError(error);
    console.error("[GTasks] Complete task failed:", cat.reason, error);
    return { ok: false, reason: cat.reason, message: cat.message };
  }
}

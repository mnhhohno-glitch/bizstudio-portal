import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI
  );
}

export function getAuthUrl(state?: string): string {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/tasks",
    ],
    state: state || "",
  });
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getCalendarEvents(
  userId: string,
  date: string,
  // T-139: 読み取り先カレンダーの明示指定。省略時は従来どおり接続ユーザー自身のカレンダー（挙動不変）。
  calendarIdOverride?: string
) {
  // T-167: リフレッシュ処理は getAuthenticatedOAuth2Client に一本化した（同一ロジックの二重実装をやめる）。
  //   未接続・リフレッシュ失敗はいずれも null → 従来どおり [] を返す（呼び出し元の契約は不変）。
  const auth = await getAuthenticatedOAuth2Client(userId);
  if (!auth) return [];

  const calendar = google.calendar({ version: "v3", auth: auth.oauth2Client });

  const startOfDay = new Date(`${date}T00:00:00+09:00`);
  const endOfDay = new Date(`${date}T23:59:59+09:00`);

  try {
    const response = await calendar.events.list({
      calendarId: calendarIdOverride || auth.calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    return (response.data.items || [])
      .filter((event) => event.start?.dateTime)
      .map((event) => ({
        id: event.id || "",
        summary: event.summary || "（無題）",
        start: formatTimeJST(event.start?.dateTime || ""),
        end: formatTimeJST(event.end?.dateTime || ""),
      }));
  } catch (error) {
    console.error("Google Calendar events fetch failed:", error);
    return [];
  }
}

/**
 * T-139: 指定カレンダーの [timeMin, timeMax) の予定を一括取得する（仮予約カレンダーの走査用）。
 * 既存関数は一切変更せず新規追加。失敗時は null（呼び出し側が「読めなかった」と判別できるよう [] と区別する）。
 */
export async function listCalendarEventsRange(
  userId: string,
  timeMinISO: string,
  timeMaxISO: string,
  calendarIdOverride?: string
): Promise<{ id: string; summary: string; startISO: string; endISO: string }[] | null> {
  try {
    const auth = await getAuthenticatedCalendar(userId);
    if (!auth) return null;

    const res = await auth.calendar.events.list({
      calendarId: calendarIdOverride || auth.calendarId,
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
    });

    return (res.data.items || [])
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        id: e.id || "",
        summary: e.summary || "",
        startISO: e.start!.dateTime!,
        endISO: e.end!.dateTime!,
      }));
  } catch (error) {
    console.error("[GCal] List events range failed:", error);
    return null;
  }
}

function formatTimeJST(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  });
}

// ---------------------------------------------------------------------------
// T-167: トークンリフレッシュ失敗時の「無条件削除」をやめる。
//
// 従来は refresh が失敗した瞬間にエラー種別を一切見ずに GoogleCalendarConnection を
// delete していたため、Google 側の 5xx・ネットワーク瞬断・タイムアウトのような
// **一時障害でも接続が永久に失われ**、ユーザーが手で再認証するまで復旧しなかった。
// （実際に大野将幸・奥村裕司の接続が消失し、日程調整AIが停止した。）
//
// 方針: 「ユーザーの再認証なしには絶対に回復しない」エラーのみ削除する。
//   判別不能なエラーは **削除しない側に倒す**（誤って残った接続は次回リフレッシュで
//   再判定されるだけだが、誤って消した接続は再認証操作なしには戻らないため）。
// ---------------------------------------------------------------------------

/** これらのみ「永久失効」とみなして接続レコードを削除する。 */
const PERMANENT_REFRESH_ERROR_CODES = new Set([
  "invalid_grant", // アクセス取消・パスワード変更・refresh token 失効・6ヶ月未使用
  "invalid_client",
  "unauthorized_client",
]);

/**
 * googleapis / google-auth-library が投げるエラーから OAuth エラーコードを取り出す。
 * 取り出せなければ null（＝判別不能。呼び出し側は「削除しない」に倒す）。
 */
function extractOAuthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { response?: { data?: unknown }; data?: unknown; message?: unknown };

  // GaxiosError: error.response.data = { error: "invalid_grant", error_description: "..." }
  const data = e.response?.data ?? e.data;
  if (data && typeof data === "object") {
    const raw = (data as { error?: unknown }).error;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    // 一部の API エラーは { error: { status: "UNAUTHENTICATED", ... } } 形式
    if (raw && typeof raw === "object") {
      const status = (raw as { status?: unknown }).status;
      if (typeof status === "string" && status.trim()) return status.trim();
    }
  }

  // バージョンによっては message 先頭にコードだけが載る（例: "invalid_grant: Token has been expired or revoked."）
  if (typeof e.message === "string") {
    const head = e.message.split(/[:\s]/)[0];
    if (PERMANENT_REFRESH_ERROR_CODES.has(head)) return head;
  }
  return null;
}

/**
 * アクセストークンを更新して DB に書き戻す（成功時のみ）。
 * 失敗時は必ず throw する。永久失効エラーのときだけ接続レコードを削除する。
 * 呼び出し元は catch して従来どおり null / [] を返す（既存シグネチャは変えない）。
 */
async function refreshConnectionTokens(
  userId: string,
  oauth2Client: ReturnType<typeof createOAuth2Client>,
  connection: { refreshToken: string }
): Promise<void> {
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await prisma.googleCalendarConnection.update({
      where: { userId },
      data: {
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token || connection.refreshToken,
        tokenExpiry: new Date(credentials.expiry_date!),
      },
    });
    oauth2Client.setCredentials(credentials);
  } catch (error) {
    const code = extractOAuthErrorCode(error);
    const permanent = code !== null && PERMANENT_REFRESH_ERROR_CODES.has(code);

    if (permanent) {
      console.error(
        `[GCal] Token refresh failed: userId=${userId} code=${code} classified=permanent action=DELETED_CONNECTION (再認証が必要)`,
        error
      );
      try {
        await prisma.googleCalendarConnection.delete({ where: { userId } });
      } catch (delErr) {
        // 並行実行で既に消えている等。削除できなくても呼び出し元の挙動は変えない。
        console.error(`[GCal] Connection delete failed: userId=${userId}`, delErr);
      }
    } else {
      console.error(
        `[GCal] Token refresh failed: userId=${userId} code=${code ?? "unknown"} classified=transient action=KEPT_CONNECTION (次回呼び出しで再試行)`,
        error
      );
    }
    throw error;
  }
}

// Shared: get an authenticated OAuth2 client for a user (with token refresh).
// Used by both Calendar and Tasks helpers. Returns null when the user is not connected
// or token refresh fails.
export async function getAuthenticatedOAuth2Client(userId: string) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });

  if (connection.tokenExpiry < new Date()) {
    try {
      await refreshConnectionTokens(userId, oauth2Client, connection);
    } catch {
      // 分類とログは refreshConnectionTokens 内で済んでいる。
      // 呼び出し元（googleTasks 等）は try/catch 無しで呼ぶため、ここで throw せず null を返す。
      return null;
    }
  }

  return { oauth2Client, calendarId: connection.calendarId };
}

// Helper: get authenticated calendar client for a user (with token refresh)
async function getAuthenticatedCalendar(userId: string) {
  const auth = await getAuthenticatedOAuth2Client(userId);
  if (!auth) return null;
  return { calendar: google.calendar({ version: "v3", auth: auth.oauth2Client }), calendarId: auth.calendarId };
}

function toRFC3339(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:mm → RFC3339 in JST
  return `${date}T${time}:00+09:00`;
}

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return dt.toLocaleDateString("sv-SE");
}

export async function createCalendarEvent(
  userId: string,
  date: string,
  eventData: { summary: string; startTime: string; endTime: string; description?: string; allDay?: boolean },
  // T-139: 書き込み先カレンダーの明示指定（共有「仮予約」カレンダー用）。
  // 省略時は従来どおり接続ユーザー自身のカレンダー（connection.calendarId）に書く＝既存呼び出しは挙動不変。
  calendarIdOverride?: string
): Promise<string | null> {
  try {
    const auth = await getAuthenticatedCalendar(userId);
    if (!auth) return null;

    const startEnd = eventData.allDay
      ? {
          start: { date },
          end: { date: addOneDay(date) },
        }
      : {
          start: { dateTime: toRFC3339(date, eventData.startTime), timeZone: "Asia/Tokyo" },
          end: { dateTime: toRFC3339(date, eventData.endTime), timeZone: "Asia/Tokyo" },
        };

    const res = await auth.calendar.events.insert({
      calendarId: calendarIdOverride || auth.calendarId,
      requestBody: {
        summary: eventData.summary,
        ...startEnd,
        description: eventData.description || undefined,
      },
    });

    return res.data.id || null;
  } catch (error) {
    console.error("[GCal] Create event failed:", error);
    return null;
  }
}

export async function updateCalendarEvent(
  userId: string,
  calendarEventId: string,
  date: string,
  eventData: { summary?: string; startTime?: string; endTime?: string; allDay?: boolean }
): Promise<void> {
  try {
    const auth = await getAuthenticatedCalendar(userId);
    if (!auth) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: any = {};
    if (eventData.summary !== undefined) requestBody.summary = eventData.summary;

    if (eventData.allDay) {
      requestBody.start = { date };
      requestBody.end = { date: addOneDay(date) };
    } else {
      if (eventData.startTime !== undefined) requestBody.start = { dateTime: toRFC3339(date, eventData.startTime), timeZone: "Asia/Tokyo" };
      if (eventData.endTime !== undefined) requestBody.end = { dateTime: toRFC3339(date, eventData.endTime), timeZone: "Asia/Tokyo" };
    }

    await auth.calendar.events.patch({
      calendarId: auth.calendarId,
      eventId: calendarEventId,
      requestBody,
    });
  } catch (error) {
    console.error("[GCal] Update event failed:", error);
  }
}

export async function deleteCalendarEvent(userId: string, calendarEventId: string): Promise<void> {
  try {
    const auth = await getAuthenticatedCalendar(userId);
    if (!auth) return;

    await auth.calendar.events.delete({
      calendarId: auth.calendarId,
      eventId: calendarEventId,
    });
  } catch (error: unknown) {
    // 404 = already deleted, ignore
    if (error && typeof error === "object" && "code" in error && (error as { code: number }).code === 404) return;
    console.error("[GCal] Delete event failed:", error);
  }
}

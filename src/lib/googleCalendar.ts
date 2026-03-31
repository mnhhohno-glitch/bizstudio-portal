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
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state: state || "",
  });
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getCalendarEvents(userId: string, date: string) {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId },
  });

  if (!connection) return [];

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });

  // Refresh token if expired
  if (connection.tokenExpiry < new Date()) {
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
      console.error("Google Calendar token refresh failed:", error);
      await prisma.googleCalendarConnection.delete({ where: { userId } });
      return [];
    }
  }

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const startOfDay = new Date(`${date}T00:00:00+09:00`);
  const endOfDay = new Date(`${date}T23:59:59+09:00`);

  try {
    const response = await calendar.events.list({
      calendarId: connection.calendarId,
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

function formatTimeJST(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  });
}

// Helper: get authenticated calendar client for a user (with token refresh)
async function getAuthenticatedCalendar(userId: string) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });

  if (connection.tokenExpiry < new Date()) {
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
    } catch {
      console.error("[GCal] Token refresh failed for write, deleting connection");
      await prisma.googleCalendarConnection.delete({ where: { userId } });
      return null;
    }
  }

  return { calendar: google.calendar({ version: "v3", auth: oauth2Client }), calendarId: connection.calendarId };
}

function toRFC3339(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:mm → RFC3339 in JST
  return `${date}T${time}:00+09:00`;
}

export async function createCalendarEvent(
  userId: string,
  date: string,
  eventData: { summary: string; startTime: string; endTime: string; description?: string }
): Promise<string | null> {
  try {
    const auth = await getAuthenticatedCalendar(userId);
    if (!auth) return null;

    const res = await auth.calendar.events.insert({
      calendarId: auth.calendarId,
      requestBody: {
        summary: eventData.summary,
        start: { dateTime: toRFC3339(date, eventData.startTime), timeZone: "Asia/Tokyo" },
        end: { dateTime: toRFC3339(date, eventData.endTime), timeZone: "Asia/Tokyo" },
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
  eventData: { summary?: string; startTime?: string; endTime?: string }
): Promise<void> {
  try {
    const auth = await getAuthenticatedCalendar(userId);
    if (!auth) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: any = {};
    if (eventData.summary !== undefined) requestBody.summary = eventData.summary;
    if (eventData.startTime !== undefined) requestBody.start = { dateTime: toRFC3339(date, eventData.startTime), timeZone: "Asia/Tokyo" };
    if (eventData.endTime !== undefined) requestBody.end = { dateTime: toRFC3339(date, eventData.endTime), timeZone: "Asia/Tokyo" };

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

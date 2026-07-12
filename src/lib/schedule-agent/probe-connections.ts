// T-139 step5: 対象CAの Google カレンダー連携状態を能動的に判定する。
//
// 既存の getCalendarEvents は「未接続」「refresh失敗」「list失敗」「実際に予定ゼロ」の
// 4パターンすべてで [] を返すため、**連携切れと空き（予定ゼロ）を区別できない**。
// このプローブは 3状態を明確に返す:
//   - "ok"             : 接続あり・トークン有効・events.list 成功
//   - "no_connection"  : GoogleCalendarConnection レコード自体が無い
//   - "refresh_failed" : レコードはあったが refresh に失敗（既存ヘルパが自動削除する）
//   - "fetch_failed"   : 認証は通ったが events.list が例外（権限剥奪・一時障害等）
//
// 判定手順の副作用: refresh_failed は既存 getAuthenticatedOAuth2Client 内で
//   接続レコードが自動削除される（本タスクで新たに削除する処理は追加しない）。
import { prisma } from "@/lib/prisma";
import { listCalendarEventsRange } from "@/lib/googleCalendar";
import { jstIso, jstYmd } from "./jst";

export type ConnectionStatus = "ok" | "no_connection" | "refresh_failed" | "fetch_failed";

export type ProbeResult = { userId: string; status: ConnectionStatus };

async function probeOne(userId: string): Promise<ConnectionStatus> {
  const pre = await prisma.googleCalendarConnection.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (!pre) return "no_connection";

  // 1分の細い窓を1回だけ取得（トラフィック最小・API課金ほぼゼロ）。
  const today = jstYmd();
  const result = await listCalendarEventsRange(userId, jstIso(today, "00:00"), jstIso(today, "00:01"));
  if (result !== null) return "ok";

  // null 返却は「認証取得失敗」または「list例外」。区別するため接続レコードの残存有無で判定:
  //   - 残っている: 認証は通ったが list が失敗 → fetch_failed
  //   - 消えている: refresh失敗で自動削除された → refresh_failed
  const post = await prisma.googleCalendarConnection.findUnique({
    where: { userId },
    select: { userId: true },
  });
  return post ? "fetch_failed" : "refresh_failed";
}

/** userId 配列を並列にプローブ。順序は入力配列と同じ。 */
export async function probeCalendarConnections(userIds: string[]): Promise<ProbeResult[]> {
  const uniq = Array.from(new Set(userIds));
  const results = await Promise.all(
    uniq.map(async (userId) => ({ userId, status: await probeOne(userId) }))
  );
  const map = new Map(results.map((r) => [r.userId, r]));
  return userIds
    .map((uid) => map.get(uid))
    .filter((r): r is ProbeResult => Boolean(r));
}

/** ok 以外を「壊れている」とみなす。resolve 側の除外リスト・アラート対象の両方に使う。 */
export function brokenUserIds(results: ProbeResult[]): string[] {
  return results.filter((r) => r.status !== "ok").map((r) => r.userId);
}

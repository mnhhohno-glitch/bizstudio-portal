// T-139 step5: カレンダー連携切れ CA をメール（Resend）で通知する。
//
// 重複抑止: 同一CA × 同一JST日付につき最大1通。
//   ScheduleAgentAlertLog(user_id, date) の UNIQUE 制約で判定する。
//   複数CAが同時に検知された場合は 1通にまとめて送り、対象欄に列挙する
//   （既送CAは同日中は除外＝再列挙もしない）。
//
// 送信失敗ポリシー: メール送信の成否は resolve 応答に影響させない（try/catch で握りつぶす）。
//   ログを作った直後に Resend が落ちた場合、その日のリトライはしない
//   （毎日リトライ再開・30分毎の再送を避けるトレードオフ）。
//
// 秘密情報の扱い: RESEND_API_KEY 未設定なら送らずログのみ（既存 candidate-site-notifications と同一挙動）。
import { prisma } from "@/lib/prisma";
import { jstYmd } from "./jst";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "BizStudio <noreply@bizstudio.co.jp>";
const RECIPIENT = "masayuki_oono@bizstudio.co.jp";

type BrokenCa = { userId: string; name: string; email: string };

function subject(today: string): string {
  return `【日程調整AI】カレンダー連携切れ検知（${today}）`;
}

function buildBody(brokens: BrokenCa[]): string {
  const lines: string[] = [
    "日程調整AIエージェントが、以下のCAのGoogleカレンダーを読み取れませんでした。",
    "連携が切れている可能性があります。ご確認ください。",
    "",
    "▼対象",
  ];
  for (const b of brokens) lines.push(`${b.name}（${b.email}）`);
  lines.push(
    "",
    "連携が切れているCAは空き枠の判定から除外されます。",
    "対象CAが全員読み取れない場合、応募者に「満枠」と誤って自動返信されるおそれがあります。",
    "",
    "▼確認方法",
    "portal の社員管理から該当CAのGoogleカレンダー連携を再設定してください。",
    "",
    "（このメールは同一CA・同一日につき1通のみ送信されます）"
  );
  return lines.join("\n");
}

/**
 * 連携切れCAを検知した際に呼び出す。返り値は「実際にメール送信を試みたか」だけ（呼び出し側は結果を無視して良い）。
 * 例外は内部で握りつぶす（副作用のため resolve 本体の応答を壊さない）。
 */
export async function sendBrokenCalendarAlert(brokenUserIds: string[]): Promise<{
  attempted: boolean;
  notifiedUserIds: string[];
  reason?: string;
}> {
  try {
    if (brokenUserIds.length === 0) return { attempted: false, notifiedUserIds: [] };

    const today = jstYmd();

    // 当日ログが既にある userId は除外（人単位の重複抑止）。
    const already = await prisma.scheduleAgentAlertLog.findMany({
      where: { userId: { in: brokenUserIds }, date: today },
      select: { userId: true },
    });
    const alreadySent = new Set(already.map((r) => r.userId));
    const toNotify = brokenUserIds.filter((u) => !alreadySent.has(u));
    if (toNotify.length === 0) {
      return { attempted: false, notifiedUserIds: [], reason: "already sent today" };
    }

    // 氏名・メールを取得（Employee 名優先・fallback で User 名）。
    const users = await prisma.user.findMany({
      where: { id: { in: toNotify } },
      select: { id: true, name: true, email: true, employee: { select: { name: true } } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const brokens: BrokenCa[] = toNotify
      .map((uid) => {
        const u = userMap.get(uid);
        if (!u) return null;
        return {
          userId: uid,
          name: u.employee?.name ?? u.name,
          email: u.email ?? uid,
        };
      })
      .filter((x): x is BrokenCa => Boolean(x));

    if (brokens.length === 0) {
      return { attempted: false, notifiedUserIds: [], reason: "no resolvable users" };
    }

    // 先にログ行を作成（UNIQUE 制約で並行実行の重複を防ぐ）。競合したCAはこの回では通知しない。
    const insertedUserIds: string[] = [];
    for (const b of brokens) {
      try {
        await prisma.scheduleAgentAlertLog.create({
          data: { userId: b.userId, date: today },
          select: { id: true },
        });
        insertedUserIds.push(b.userId);
      } catch {
        // UNIQUE 衝突＝別の並行実行が先に取った。この呼び出しからは除外。
      }
    }
    const finalBrokens = brokens.filter((b) => insertedUserIds.includes(b.userId));
    if (finalBrokens.length === 0) {
      return { attempted: false, notifiedUserIds: [], reason: "race lost" };
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.warn("[schedule-agent/alert] RESEND_API_KEY not configured, skipping email (log kept for dedup)");
      return { attempted: false, notifiedUserIds: finalBrokens.map((b) => b.userId), reason: "resend not configured" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [RECIPIENT],
          subject: subject(today),
          text: buildBody(finalBrokens),
        }),
        signal: controller.signal,
      });
      if (res.status === 200 || res.status === 201) {
        console.log(`[schedule-agent/alert] sent to ${RECIPIENT} for ${finalBrokens.length} CA(s)`);
      } else {
        const t = await res.text().catch(() => "");
        console.error(`[schedule-agent/alert] Resend failed: status=${res.status} body=${t.slice(0, 300)}`);
      }
    } finally {
      clearTimeout(timer);
    }

    return { attempted: true, notifiedUserIds: finalBrokens.map((b) => b.userId) };
  } catch (e) {
    console.error("[schedule-agent/alert] unexpected error:", e);
    return { attempted: false, notifiedUserIds: [], reason: "exception" };
  }
}

// T-069②：日報提出時の LINE WORKS 通知。
// 既存 sendBotMessage（src/lib/lineworks.ts）を流用。日報報告グループへ当日サマリ＋本番直リンクを送る。
// 送信は fire&forget（呼び出し側で void notifyDailyReport(...).catch(()=>{}) 。本体レスポンスをブロックしない）。
// 環境変数：LINEWORKS_DAILYREPORT_BOT_ID / LINEWORKS_DAILYREPORT_CHANNEL_ID（値はログに出さない）。

import { sendBotMessage } from "@/lib/lineworks";

// 直リンクは常に**本番ドメイン**へ（staging から送っても本番に飛ばす。PORTAL_BASE_URL は
// サービスごとに staging/本番 が異なり staging を指すため使わない。本番URL専用の定数/環境変数で固定）。
const PORTAL_PROD_URL = process.env.PORTAL_PUBLIC_URL || "https://bizstudio-portal-production.up.railway.app";

export interface DailyReportNotifyParams {
  caName: string;
  dateStr: string; // "YYYY-MM-DD"（JST）
  userId?: string; // T-085: 提出者の userId。通知リンクに付けて本人の日報を閲覧モードで開かせる。
  interviewTotal?: number;
  interviewFirst?: number;
  interviewExisting?: number;
  bmCount?: number;
  exportCount?: number; // T-092: 当日の出力数（選定率の分子）
  entryTotal?: number;
  selectionRate?: number | null;
  dCount?: number;
  plannedCount: number;
  completedCount: number;
  reportBody: string | null;
}

// メッセージ本文を組み立てる純関数（テスト・送信で共用）。
export function buildDailyReportMessage(p: DailyReportNotifyParams): string {
  const [, m, d] = p.dateStr.split("-");
  const md = `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  const digest = p.plannedCount > 0 ? Math.round((p.completedCount / p.plannedCount) * 100) : 0;
  const comment = p.reportBody && p.reportBody.trim() ? p.reportBody.trim() : "（記載なし）";

  const hasNumbers = p.interviewTotal != null;

  const lines: string[] = [
    `📋 日報提出：${p.caName}（${md}）`,
    "",
  ];

  if (hasNumbers) {
    const sel = p.selectionRate != null ? `${(p.selectionRate * 100).toFixed(1)}` : "—";
    lines.push(
      "【当日実績】",
      `・面談 ${p.interviewTotal}件（初回${p.interviewFirst}／既存${p.interviewExisting}）`,
      `・求人紹介 ${p.bmCount}件`,
      `・エントリー ${p.entryTotal}件`,
      `・選定率 ${sel}%（出力${p.exportCount ?? 0}／BM${p.bmCount}）`,
      "",
    );
  }

  lines.push(
    "【スケジュール】",
    `・予定 ${p.plannedCount}件／完了 ${p.completedCount}件（消化${digest}%）`,
    "",
    "【コメント】",
    comment,
    "",
    "▼詳細はこちら",
    // T-085: userId 付きで提出者本人の日報を閲覧モードで開く（無ければ従来通り）。
    p.userId ? `${PORTAL_PROD_URL}/?date=${p.dateStr}&userId=${p.userId}` : `${PORTAL_PROD_URL}/?date=${p.dateStr}`,
  );

  return lines.join("\n");
}

export async function notifyDailyReport(p: DailyReportNotifyParams): Promise<void> {
  const botId = process.env.LINEWORKS_DAILYREPORT_BOT_ID;
  const channelId = process.env.LINEWORKS_DAILYREPORT_CHANNEL_ID;
  if (!botId || !channelId) {
    console.warn("日報LINE通知: LINEWORKS_DAILYREPORT_BOT_ID / CHANNEL_ID 未設定のためスキップ");
    return;
  }
  await sendBotMessage(botId, channelId, buildDailyReportMessage(p));
}

// T-093: 日報コメント投稿時の通知。
// リモート中心の運用で「上司のコメントをLINEでそのまま読める」ことを目的に、
// コメント本文を見出し＋ポータルURL（本人の日報を閲覧モードで開く）と共に流す。
// 既存 notifyDailyReport と同じ日報専用ボット・チャンネルを流用する。
export interface DailyReportCommentNotifyParams {
  ownerUserId: string; // 日報の所有者（提出者）の userId（URLに付ける）
  ownerName: string;   // 提出者の氏名
  authorName: string;  // コメント投稿者の氏名
  dateStr: string;     // "YYYY-MM-DD"（JST）
  body: string;        // コメント本文
}

export function buildDailyReportCommentMessage(p: DailyReportCommentNotifyParams): string {
  const [, m, d] = p.dateStr.split("-");
  const md = `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  const url = `${PORTAL_PROD_URL}/?date=${p.dateStr}&userId=${p.ownerUserId}`;
  return [
    `💬 日報コメント：${p.ownerName}さん（${md}）に ${p.authorName}さんがコメントしました`,
    "",
    p.body,
    "",
    "▼詳細はこちら",
    url,
  ].join("\n");
}

export async function notifyDailyReportComment(p: DailyReportCommentNotifyParams): Promise<void> {
  const botId = process.env.LINEWORKS_DAILYREPORT_BOT_ID;
  const channelId = process.env.LINEWORKS_DAILYREPORT_CHANNEL_ID;
  if (!botId || !channelId) {
    console.warn("日報コメントLINE通知: LINEWORKS_DAILYREPORT_BOT_ID / CHANNEL_ID 未設定のためスキップ");
    return;
  }
  await sendBotMessage(botId, channelId, buildDailyReportCommentMessage(p));
}

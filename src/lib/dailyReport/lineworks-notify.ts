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
  interviewTotal: number;
  interviewFirst: number;
  interviewExisting: number; // 求人面談(2回目)+既存面談(3回目以降)
  bmCount: number; // 求人紹介数（BM数）
  entryTotal: number;
  selectionRate: number | null; // 0〜1
  dCount: number; // 当日BM の aiMatchRating=D 件数
  plannedCount: number;
  completedCount: number;
  reportBody: string | null; // 統合コメント本文（定型■1〜■6）
}

// メッセージ本文を組み立てる純関数（テスト・送信で共用）。
export function buildDailyReportMessage(p: DailyReportNotifyParams): string {
  const [, m, d] = p.dateStr.split("-");
  const md = `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  const sel = p.selectionRate != null ? `${(p.selectionRate * 100).toFixed(1)}` : "—";
  const digest = p.plannedCount > 0 ? Math.round((p.completedCount / p.plannedCount) * 100) : 0;
  const comment = p.reportBody && p.reportBody.trim() ? p.reportBody.trim() : "（記載なし）";
  return [
    `📋 日報提出：${p.caName}（${md}）`,
    "",
    "【当日実績】",
    `・面談 ${p.interviewTotal}件（初回${p.interviewFirst}／既存${p.interviewExisting}）`,
    `・求人紹介 ${p.bmCount}件`,
    `・エントリー ${p.entryTotal}件`,
    `・選定率 ${sel}%（BM${p.bmCount}／D${p.dCount}）`,
    "",
    "【スケジュール】",
    `・予定 ${p.plannedCount}件／完了 ${p.completedCount}件（消化${digest}%）`,
    "",
    "【コメント】",
    comment,
    "",
    "▼詳細・グラフはこちら",
    `${PORTAL_PROD_URL}/?date=${p.dateStr}`,
  ].join("\n");
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

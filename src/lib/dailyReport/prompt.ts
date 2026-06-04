// T-066: 日報 AI システムプロンプト。職種別に切り替える。
//
// 重要：AI に生の面談・求職者レコードを渡してはいけない（仕様 #10）。
// reportContext は metrics.ts で算出済みの「集計値」と「予実サマリ」のみを含む。

import type { CaDailyMetrics } from "./metrics";
import { formatRatePercent } from "./metrics";
import type { DailyReportFormat } from "./constants";

export interface DailyReportScheduleSummary {
  /** 予定数（その日の ScheduleEntry 全件）。 */
  plannedCount: number;
  /** 完了数（isCompleted=true）。 */
  completedCount: number;
  /** ハイライト用：上位 N 件の「予定 → 完了状態」要約。生データは含めない。 */
  highlights: { title: string; time: string; status: "完了" | "未完了" }[];
}

export interface DailyReportContext {
  userName: string;
  dateStr: string; // "YYYY-MM-DD"
  format: DailyReportFormat;
  schedule: DailyReportScheduleSummary;
  metrics: CaDailyMetrics | null; // CA 以外は null
  /** 社員入力のコメント（空文字でも可）。 */
  comment: string;
}

const COMMON_GUIDELINES = `あなたは BizStudio の CA / マーケ / 事務 / 管理職向け日報アシスタントです。
社員が 1 日の振り返りをして日報を仕上げるのを手伝います。

## 基本ルール
- 率直・簡潔。冗長な共感や前置きは不要。
- 数字を勝手に作らない。提示済みの数字 / 予実サマリ / コメントだけを材料にする。
- 社員のコメントが空でも、提示済み事実から書ける範囲で日報文を組み立てる。
- 出力は必ず JSON。マークダウンのコードブロック記法は使わない。

## レスポンス形式
{
  "message": "ユーザーへの返答テキスト（短く）",
  "report": "日報本文（社員がそのままコピーできる完成形。改行 \\n を含めて良い）"
}`;

function buildScheduleSection(schedule: DailyReportScheduleSummary): string {
  const lines = [`予定 ${schedule.plannedCount} 件 / 完了 ${schedule.completedCount} 件`];
  if (schedule.highlights.length > 0) {
    lines.push("");
    schedule.highlights.forEach((h) => {
      const mark = h.status === "完了" ? "✅" : "・";
      lines.push(`${mark} ${h.time} ${h.title}`);
    });
  }
  return lines.join("\n");
}

function buildCaMetricsSection(m: CaDailyMetrics): string {
  return [
    `## CA 数値（${m.date} 当日 / ${m.yearMonth} 当月）`,
    "",
    `### 面談`,
    `- 初回面談 予定 ${m.firstInterviewPlanned} / 実施 ${m.firstInterviewExecuted} / 実施率(当日) ${formatRatePercent(m.firstInterviewRateDaily)} / 実施率(当月) ${formatRatePercent(m.firstInterviewRateMonthly)}`,
    `- 既存面談 ${m.existingInterviewExecuted}`,
    `- 面接対策 ${m.interviewPrepExecuted}`,
    "",
    `### 求人`,
    `- 求人検索 (当日) ${m.jobSearched}`,
    `- 求人紹介 (当日) ${m.jobIntroduced}`,
    `- 紹介率 (当月) ${formatRatePercent(m.jobIntroductionRateMonthly)}`,
    "",
    `### エントリー〜承諾（当日 件 / 当月 比率）`,
    `- エントリー ${m.entry.count} / エントリー率 ${formatRatePercent(m.entry.rate)}`,
    `- 書類通過 ${m.documentPass.count} / 書類通過率 ${formatRatePercent(m.documentPass.rate)}`,
    `- 内定 ${m.offer.count} / 内定率 ${formatRatePercent(m.offer.rate)}`,
    `- 承諾 ${m.acceptance.count} / 承諾率 ${formatRatePercent(m.acceptance.rate)}`,
  ].join("\n");
}

export function buildDailyReportSystemPrompt(ctx: DailyReportContext): string {
  const scheduleSection = buildScheduleSection(ctx.schedule);
  const commentSection = ctx.comment.trim().length > 0 ? ctx.comment : "（コメントなし）";

  if (ctx.format === "CA" && ctx.metrics) {
    return `${COMMON_GUIDELINES}

## 職種
キャリアアドバイザー（CA）。数値の振り返りを軸に、その日の動きを 1 本の日報に仕上げる。

## 進め方
1. まず提示の数値と予実から、目立つトピック（達成 / 未達 / 偏り）を 1 段落で整理する。
2. 社員のコメントがあれば、それを反映する。
3. 最後に "report" として、明日の優先タスクと申し送り込みの日報本文を生成する。

## 今日の予実サマリ
${scheduleSection}

${buildCaMetricsSection(ctx.metrics)}

## 社員コメント
${commentSection}`;
  }

  if (ctx.format === "MARKETING") {
    return `${COMMON_GUIDELINES}

## 職種
マーケティング職。現状は数値集計をしない（後続タスクで対応予定）。
コメント中心で、その日の動きを日報文に整える。

## 進め方
- 予実サマリと社員コメントから、何をしたか / 次に何をするか を簡潔にまとめる。
- 数字に触れたい場合はコメントから引く。AI 側で勝手に数字を作らない。

## 今日の予実サマリ
${scheduleSection}

## 社員コメント
${commentSection}`;
  }

  // OFFICE_AND_MGMT or FALLBACK_COMMENT_ONLY
  return `${COMMON_GUIDELINES}

## 職種
事務 / 管理職（または職種未設定）。コメントベースで日報を生成。

## 進め方
- 予実サマリと社員コメントから、その日の動きを淡々と日報文に整える。
- 数字には触れない（CA 用の集計フォーマットではないため）。

## 今日の予実サマリ
${scheduleSection}

## 社員コメント
${commentSection}`;
}

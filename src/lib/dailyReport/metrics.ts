// T-066/T-071: CA 数値の集計（仕様 4-2）。
//
// 厳守事項：
//   - 初回/既存判定は interviewCount（=1 初回, >=2 既存）。interviewType 文字列で判定しない（仕様 4-1）。
//   - 辞退系は INTERVIEW_DECLINED_FLAGS。これら以外（null 含む）を実施扱い。
//     Prisma の { notIn } は SQL 標準で NULL を除外するため、OR で resultFlag IS NULL を明示する。
//   - JST 境界は jstDate.ts のヘルパ経由のみ。toISOString().slice(0,10) や
//     `dateStr + "T00:00:00.000Z"` で範囲を作るのは禁止（罠 #17/#36）。
//   - AI には生の面談・求職者レコードを渡さない。本ファイルが返す集計済み数値だけを渡す（仕様 #10）。
//
// T-071：実績表のため「from〜to の単一レンジ集計」を computeCaMetricsForRange に一般化し、
//        日報用の computeCaMetrics（当日 + 当月の2窓）はそのラッパーに置き換えた。
//        日報側の出力（CaDailyMetrics）は一切変えていない。

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  INTERVIEW_DECLINED_FLAGS,
  INTERVIEW_TYPE_INTERVIEW_PREP,
} from "./constants";
import {
  jstDateEnd,
  jstDateStart,
  jstMonthStart,
  jstNextMonthStart,
} from "./jstDate";

export interface CaCountWithRate {
  count: number;
  // 紐づく分母（例：紹介数の母=検索数）。集計窓は同じ。
  denominator?: number;
  // count / denominator。分母 0 は null（0除算回避）。
  rate?: number | null;
}

// === 単一レンジの集計結果（T-071 実績表で使用） ===
export interface CaRangeMetrics {
  fromIso: string;
  toIso: string;
  // 面談
  firstInterviewPlanned: number; // 初回面談予定数（辞退系含む全件）
  firstInterviewExecuted: number; // 初回面談実施数（辞退系除く・null 含む）
  firstInterviewRate: number | null; // 実施 ÷ 予定
  existingInterviewExecuted: number; // 既存面談数（実施のみ）
  interviewPrepExecuted: number; // 面接対策数
  // 求人
  jobSearched: number; // 求人検索数
  jobIntroduced: number; // 求人紹介数
  jobIntroductionRate: number | null; // 紹介 ÷ 検索
  // エントリー〜承諾（各 count/denominator/rate は同一レンジ）
  entry: CaCountWithRate; // 分母=紹介数
  documentPass: CaCountWithRate; // 分母=エントリー数
  offer: CaCountWithRate; // 分母=書類通過数
  acceptance: CaCountWithRate; // 分母=内定数
}

export interface CaDailyMetrics {
  date: string; // "YYYY-MM-DD"（JST）
  yearMonth: string; // "YYYY-MM"
  // 面談
  firstInterviewPlanned: number; // 当日 初回面談予定数
  firstInterviewExecuted: number; // 当日 初回面談実施数
  firstInterviewRateDaily: number | null; // 当日 初回面談実施率
  firstInterviewRateMonthly: number | null; // 当月 初回面談実施率
  existingInterviewExecuted: number; // 当日 既存面談数（実施のみ）
  interviewPrepExecuted: number; // 当日 面接対策数
  // 求人
  jobSearched: number; // 当日 求人検索数（BOOKMARK 作成）
  jobIntroduced: number; // 当日 求人紹介数（BOOKMARK 紹介済）
  jobIntroductionRateMonthly: number | null; // 当月 求人紹介率
  // エントリー〜承諾
  entry: CaCountWithRate; // 当日 件数 + 当月 エントリー率（分母=当月紹介数）
  documentPass: CaCountWithRate; // 当日 + 当月 書類通過率（分母=当月エントリー数）
  offer: CaCountWithRate; // 当日 + 当月 内定率（分母=当月書類通過数）
  acceptance: CaCountWithRate; // 当日 + 当月 承諾率（分母=当月内定数）
}

/**
 * from〜to（JST の Date 範囲、両端含む）で CA 数値を集計する汎用関数。
 * 4-3 の紐づきキーに従い使い分ける。
 * - 面談：InterviewRecord.interviewerUserId = employeeId
 * - 求人検索/紹介：CandidateFile.uploadedByUserId = userId
 * - エントリー以降：JobEntry.careerAdvisorId = employeeId（実データは Employee.id が入っている）
 */
export async function computeCaMetricsForRange(params: {
  userId: string;
  employeeId: string | null;
  from: Date;
  to: Date;
}): Promise<CaRangeMetrics> {
  const { userId, employeeId, from, to } = params;
  const range = { gte: from, lte: to };

  // 「実施」フィルタ：辞退系以外（NULL は実施扱い）。
  // Prisma の `{ notIn: [...] }` は SQL 標準どおり NULL を除外するため、
  // OR で `resultFlag IS NULL` を明示的に含める必要がある（仕様 4-1 / 罠 #37）。
  const notDeclined = {
    OR: [
      { resultFlag: null },
      { resultFlag: { notIn: INTERVIEW_DECLINED_FLAGS.map((s) => s) } },
    ],
  };

  // 面談：担当軸（候補者の担当 CA = candidate.employeeId = Employee.id）。
  // 実施者軸（interviewerUserId）はやめる。岡田=面談官（実施者58/担当0）のように
  // 実施者軸は CA 実績を表さず、面談管理画面の「担当CA」絞り（candidate.employee）と一致しない。
  // 担当軸なら面談管理「担当CA=大野」の件数と一致する（初回59=59 で検証済み）。
  const interviewerFilter = { candidate: { employeeId: employeeId ?? "__nonexistent__" } };

  // 求人（CandidateFile, uploadedByUserId = User.id）
  //
  // エントリー以降（JobEntry）：実績表は「過去に何件到達したか」の累積実績を見る。
  // - 担当キーは候補者の担当 CA = candidate.employeeId（Employee.id）。
  //   JobEntry.careerAdvisorId は実データの 99.9% が NULL のため使えない（再調査で判明）。
  //   管理画面 /api/entries の「担当」フィルタも careerAdvisorName → candidate.employee.name。
  // - 無効（isActive=false）も含む：過去の実績の一部なので除外しない（T-067 失効済みでもカウント）。
  // - アーカイブ（archivedAt あり）は削除扱いで除く。
  const advisorFilter = {
    candidate: { employeeId: employeeId ?? "__nonexistent__" },
    archivedAt: null,
  };

  // エントリー（応募到達）：entryFlag が応募以降に到達した全件（求人紹介段階を除く）。
  // hasEntry/hasJoined は実データで全件 false の未使用フィールドのため使えない。entryFlag の進行度で判定。
  const entryFlagPostApplication = {
    entryFlag: { in: ["応募", "エントリー", "書類選考", "面接", "内定", "入社済"] },
  };

  // エントリー以降は「何人がその段階に到達したか」＝候補者ユニーク人数で数える（T-071 修正）。
  // 同一候補者が同月に複数社で同段階に到達しても 1。月をまたげば各月で別カウント（レンジが別）。
  // distinct: ["candidateId"] で候補者ユニークの行を取り、その件数を数える。
  const countUniqueCandidates = async (where: Prisma.JobEntryWhereInput): Promise<number> => {
    const rows = await prisma.jobEntry.findMany({
      where,
      select: { candidateId: true },
      distinct: ["candidateId"],
    });
    return rows.length;
  };

  const [
    firstPlanned,
    firstExecuted,
    existingExecuted,
    prepExecuted,
    jobSearched,
    jobIntroduced,
    entryCount,
    documentPassCount,
    offerCount,
    acceptanceCount,
  ] = await Promise.all([
    prisma.interviewRecord.count({
      where: { ...interviewerFilter, interviewCount: 1, interviewDate: range },
    }),
    prisma.interviewRecord.count({
      where: { ...interviewerFilter, interviewCount: 1, ...notDeclined, interviewDate: range },
    }),
    prisma.interviewRecord.count({
      where: { ...interviewerFilter, interviewCount: { gte: 2 }, ...notDeclined, interviewDate: range },
    }),
    prisma.interviewRecord.count({
      where: { ...interviewerFilter, interviewType: INTERVIEW_TYPE_INTERVIEW_PREP, interviewDate: range },
    }),
    prisma.candidateFile.count({
      where: { category: "BOOKMARK", archivedAt: null, uploadedByUserId: userId, createdAt: range },
    }),
    prisma.candidateFile.count({
      where: { category: "BOOKMARK", uploadedByUserId: userId, lastExportedAt: range },
    }),
    // エントリー数：応募済み以降のステージに限定（求人紹介段階を除外）。候補者ユニーク人数。
    countUniqueCandidates({ ...advisorFilter, ...entryFlagPostApplication, entryDate: range }),
    // 書類通過/内定/承諾：それぞれの日付フィールドが非 null である時点で求人紹介段階を超えているため、
    // entryFlag ホワイトリストは不要。失効除外（archivedAt=null）のみ適用。候補者ユニーク人数。
    countUniqueCandidates({ ...advisorFilter, documentPassDate: range }),
    countUniqueCandidates({ ...advisorFilter, offerDate: range }),
    countUniqueCandidates({ ...advisorFilter, acceptanceDate: range }),
  ]);

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    firstInterviewPlanned: firstPlanned,
    firstInterviewExecuted: firstExecuted,
    firstInterviewRate: rate(firstExecuted, firstPlanned),
    existingInterviewExecuted: existingExecuted,
    interviewPrepExecuted: prepExecuted,
    jobSearched,
    jobIntroduced,
    jobIntroductionRate: rate(jobIntroduced, jobSearched),
    entry: { count: entryCount, denominator: jobIntroduced, rate: rate(entryCount, jobIntroduced) },
    documentPass: { count: documentPassCount, denominator: entryCount, rate: rate(documentPassCount, entryCount) },
    offer: { count: offerCount, denominator: documentPassCount, rate: rate(offerCount, documentPassCount) },
    acceptance: { count: acceptanceCount, denominator: offerCount, rate: rate(acceptanceCount, offerCount) },
  };
}

/**
 * 日報用：当日窓 + 当月窓の2レンジを集計して CaDailyMetrics を組み立てる。
 * computeCaMetricsForRange のラッパー。出力は T-066 から不変。
 * - count 系：当日窓
 * - 率系：当月窓（紹介率・エントリー率・通過率・内定率・承諾率・初回面談実施率の当月版）
 */
export async function computeCaMetrics(params: {
  userId: string;
  employeeId: string | null;
  dateStr: string; // "YYYY-MM-DD"（JST 日付）
}): Promise<CaDailyMetrics> {
  const { userId, employeeId, dateStr } = params;

  const dayFrom = jstDateStart(dateStr);
  const dayTo = jstDateEnd(dateStr);
  const monthFrom = jstMonthStart(dateStr);
  // 当月窓は jstNextMonthStart（排他）の 1ms 手前を lte に使い、従来の lt と等価にする。
  const monthTo = new Date(jstNextMonthStart(dateStr).getTime() - 1);

  const [day, month] = await Promise.all([
    computeCaMetricsForRange({ userId, employeeId, from: dayFrom, to: dayTo }),
    computeCaMetricsForRange({ userId, employeeId, from: monthFrom, to: monthTo }),
  ]);

  return {
    date: dateStr,
    yearMonth: dateStr.slice(0, 7),
    // 面談
    firstInterviewPlanned: day.firstInterviewPlanned,
    firstInterviewExecuted: day.firstInterviewExecuted,
    firstInterviewRateDaily: day.firstInterviewRate,
    firstInterviewRateMonthly: month.firstInterviewRate,
    existingInterviewExecuted: day.existingInterviewExecuted,
    interviewPrepExecuted: day.interviewPrepExecuted,
    // 求人
    jobSearched: day.jobSearched,
    jobIntroduced: day.jobIntroduced,
    jobIntroductionRateMonthly: month.jobIntroductionRate,
    // エントリー〜承諾：count は当日、denominator/rate は当月
    entry: { count: day.entry.count, denominator: month.entry.denominator, rate: month.entry.rate },
    documentPass: { count: day.documentPass.count, denominator: month.documentPass.denominator, rate: month.documentPass.rate },
    offer: { count: day.offer.count, denominator: month.offer.denominator, rate: month.offer.rate },
    acceptance: { count: day.acceptance.count, denominator: month.acceptance.denominator, rate: month.acceptance.rate },
  };
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * パーセント表記（小数1桁）。UI / AI prompt 共用ヘルパ。
 */
export function formatRatePercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

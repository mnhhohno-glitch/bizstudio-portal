// T-066: CA 数値の集計（仕様 4-2）。
//
// 厳守事項：
//   - 初回/既存判定は interviewCount（=1 初回, >=2 既存）。interviewType 文字列で判定しない（仕様 4-1）。
//   - 辞退系は INTERVIEW_DECLINED_FLAGS。これら以外（null 含む）を実施扱い。
//   - 当日窓は JST の 0:00〜23:59:59.999、当月窓は JST の月初〜翌月初（排他）。
//     toISOString().slice(0,10) や `dateStr + "T00:00:00.000Z"` で範囲を作るのは禁止（罠 #17）。
//   - AI には生の面談・求職者レコードを渡さない。本ファイルが返す集計済み数値だけを渡す（仕様 #10）。

import { prisma } from "@/lib/prisma";
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
 * userId（User.id）と employeeId（Employee.id）の両方から CA 数値を集計する。
 * 4-3 の紐づきキーに従い使い分ける。
 * - 面談：InterviewRecord.interviewerUserId = employeeId
 * - 求人検索/紹介：CandidateFile.uploadedByUserId = userId
 * - エントリー以降：JobEntry.careerAdvisorId = userId
 */
export async function computeCaMetrics(params: {
  userId: string;
  employeeId: string | null;
  dateStr: string; // "YYYY-MM-DD"（JST 日付）
}): Promise<CaDailyMetrics> {
  const { userId, employeeId, dateStr } = params;

  const dayStart = jstDateStart(dateStr);
  const dayEnd = jstDateEnd(dateStr);
  const monthStart = jstMonthStart(dateStr);
  const monthEnd = jstNextMonthStart(dateStr); // 排他

  const yearMonth = dateStr.slice(0, 7);

  const declinedNotIn = { notIn: INTERVIEW_DECLINED_FLAGS.map((s) => s) };

  // === 面談（employeeId が無いユーザーは 0 件で確定） ===
  const interviewerFilter = employeeId
    ? { interviewerUserId: employeeId }
    : { interviewerUserId: "__nonexistent__" };

  const [
    firstInterviewPlannedDay,
    firstInterviewExecutedDay,
    firstInterviewPlannedMonth,
    firstInterviewExecutedMonth,
    existingInterviewExecutedDay,
    interviewPrepExecutedDay,
  ] = await Promise.all([
    prisma.interviewRecord.count({
      where: {
        ...interviewerFilter,
        interviewCount: 1,
        interviewDate: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.interviewRecord.count({
      where: {
        ...interviewerFilter,
        interviewCount: 1,
        resultFlag: declinedNotIn,
        interviewDate: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.interviewRecord.count({
      where: {
        ...interviewerFilter,
        interviewCount: 1,
        interviewDate: { gte: monthStart, lt: monthEnd },
      },
    }),
    prisma.interviewRecord.count({
      where: {
        ...interviewerFilter,
        interviewCount: 1,
        resultFlag: declinedNotIn,
        interviewDate: { gte: monthStart, lt: monthEnd },
      },
    }),
    prisma.interviewRecord.count({
      where: {
        ...interviewerFilter,
        interviewCount: { gte: 2 },
        resultFlag: declinedNotIn,
        interviewDate: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.interviewRecord.count({
      where: {
        ...interviewerFilter,
        interviewType: INTERVIEW_TYPE_INTERVIEW_PREP,
        interviewDate: { gte: dayStart, lte: dayEnd },
      },
    }),
  ]);

  // === 求人（CandidateFile, BOOKMARK） ===
  const [
    jobSearchedDay,
    jobIntroducedDay,
    jobSearchedMonth,
    jobIntroducedMonth,
  ] = await Promise.all([
    prisma.candidateFile.count({
      where: {
        category: "BOOKMARK",
        archivedAt: null,
        uploadedByUserId: userId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.candidateFile.count({
      where: {
        category: "BOOKMARK",
        uploadedByUserId: userId,
        lastExportedAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.candidateFile.count({
      where: {
        category: "BOOKMARK",
        archivedAt: null,
        uploadedByUserId: userId,
        createdAt: { gte: monthStart, lt: monthEnd },
      },
    }),
    prisma.candidateFile.count({
      where: {
        category: "BOOKMARK",
        uploadedByUserId: userId,
        lastExportedAt: { gte: monthStart, lt: monthEnd },
      },
    }),
  ]);

  // === エントリー以降（JobEntry） ===
  // entryDate は user 入力なので null の可能性あり → 仕様 R4 で createdAt 近似は集計外。
  // ここは entryDate 厳密一致でカウントし、近似は将来 separate 関数で扱う。
  const advisorFilter = { careerAdvisorId: userId };

  const [
    entryDay,
    documentPassDay,
    offerDay,
    acceptanceDay,
    entryMonth,
    documentPassMonth,
    offerMonth,
    acceptanceMonth,
  ] = await Promise.all([
    prisma.jobEntry.count({
      where: { ...advisorFilter, entryDate: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, documentPassDate: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, offerDate: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, acceptanceDate: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, entryDate: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, documentPassDate: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, offerDate: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.jobEntry.count({
      where: { ...advisorFilter, acceptanceDate: { gte: monthStart, lt: monthEnd } },
    }),
  ]);

  // === 比率（4-2 の窓に厳密に従う。0 除算は null） ===
  return {
    date: dateStr,
    yearMonth,
    // 面談
    firstInterviewPlanned: firstInterviewPlannedDay,
    firstInterviewExecuted: firstInterviewExecutedDay,
    firstInterviewRateDaily: rate(firstInterviewExecutedDay, firstInterviewPlannedDay),
    firstInterviewRateMonthly: rate(firstInterviewExecutedMonth, firstInterviewPlannedMonth),
    existingInterviewExecuted: existingInterviewExecutedDay,
    interviewPrepExecuted: interviewPrepExecutedDay,
    // 求人
    jobSearched: jobSearchedDay,
    jobIntroduced: jobIntroducedDay,
    jobIntroductionRateMonthly: rate(jobIntroducedMonth, jobSearchedMonth),
    // エントリー〜承諾
    entry: { count: entryDay, denominator: jobIntroducedMonth, rate: rate(entryMonth, jobIntroducedMonth) },
    documentPass: { count: documentPassDay, denominator: entryMonth, rate: rate(documentPassMonth, entryMonth) },
    offer: { count: offerDay, denominator: documentPassMonth, rate: rate(offerMonth, documentPassMonth) },
    acceptance: { count: acceptanceDay, denominator: offerMonth, rate: rate(acceptanceMonth, offerMonth) },
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

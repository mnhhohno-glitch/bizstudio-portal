import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";
import { todayJstDateString, toJstDateString } from "@/lib/dailyReport/jstDate";

/**
 * T-107: 求職者ダッシュボード集計 API（読み取りのみ）。
 *
 * 求職者単位の活動・対応・選考状況の14指標を返す。
 *
 * ⚠️ 選考ファネル/通過率は「履歴を持たない近似」: JobEntry は現在ステータス（entryFlag）の
 *    単一値しか持たないため、各段階の「到達」は『当該段階の日付フィールド presence』または
 *    『現在の entryFlag が当該段階以降』で判定する。過去にその段階を通って今は別ステータス、
 *    という履歴は復元できないため、率はあくまで目安。母数（到達社数）が3社未満の段階は率を null。
 *
 * 閲覧系（最終ログイン・閲覧回数）は kyuujinPDF から取得。失敗時は null（全体は落とさない）。
 */

// 罠#17: JST 変換は toLocaleString('sv-SE', {timeZone:'Asia/Tokyo'}) を使う。toISOString().slice は禁止。
function fmtJstDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/-/g, "/"); // YYYY/MM/DD
}
// kyuujin の datetime はタイムゾーン無しの UTC（"...539550"）で来るため、TZ が無ければ Z を補って UTC として解釈。
function fmtJstDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hasTz = /[zZ]$/.test(raw) || /[+-]\d\d:?\d\d$/.test(raw);
  const d = new Date(hasTz ? raw : `${raw}Z`);
  if (isNaN(d.getTime())) return null;
  const s = d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD HH:mm:ss"
  const [date, time] = s.split(" ");
  return `${date.replace(/-/g, "/")} ${(time ?? "").slice(0, 5)}`; // YYYY/MM/DD HH:mm
}
// JST 日付文字列同士の日数差（a - b）。罠#17準拠で JST 0:00 基準。
function diffJstDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00+09:00`).getTime();
  const db = new Date(`${b}T00:00:00+09:00`).getTime();
  return Math.round((da - db) / 86_400_000);
}
function maxDate(...ds: (Date | null | undefined)[]): Date | null {
  let m: Date | null = null;
  for (const d of ds) if (d && (!m || d > m)) m = d;
  return m;
}

type DailyView = { date: string; count: number };

// 今日(JST)から過去14日（直近2週間）の連続日付に閲覧ログを当て、無い日は 0 とした昇順14要素を返す。
// kyuujin の views_daily_30d をそのまま受け取り、portal 側で直近14日に絞って0埋めする。
// 罠#17: JST 基準（toJstDateString = sv-SE/Asia/Tokyo）。toISOString().slice は使わない。
const VIEW_TREND_DAYS = 14;
function buildViewsDaily(raw: { date?: string; count?: number }[]): DailyView[] {
  const today = todayJstDateString(); // "YYYY-MM-DD"（JST）
  const anchor = new Date(`${today}T12:00:00+09:00`); // JST 正午基準（DST/丸め回避）
  const byDate = new Map<string, number>();
  for (const r of raw) if (r && typeof r.date === "string") byDate.set(r.date, typeof r.count === "number" ? r.count : 0);
  const out: DailyView[] = [];
  for (let i = VIEW_TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * 86_400_000);
    const ds = toJstDateString(d);
    out.push({ date: ds, count: byDate.get(ds) ?? 0 });
  }
  return out;
}

// 閲覧系を kyuujinPDF から安全に取得（失敗で全体を落とさない）
async function fetchMypageStats(candidateNumber: string): Promise<{ lastLoginAt: string | null; accessCount: number | null; viewsDaily: DailyView[] }> {
  const secret = process.env.KYUUJIN_API_SECRET;
  if (!secret) return { lastLoginAt: null, accessCount: null, viewsDaily: buildViewsDaily([]) };
  const base = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
  try {
    const res = await fetch(`${base}/api/external/mypage/by-job-seeker/${candidateNumber}`, {
      headers: { "x-api-secret": secret },
      next: { revalidate: 0 },
    });
    if (!res.ok) return { lastLoginAt: null, accessCount: null, viewsDaily: buildViewsDaily([]) };
    const data: { access_count?: number | null; last_accessed_at?: string | null; url?: string | null; views_daily_30d?: { date?: string; count?: number }[] } = await res.json();
    return {
      lastLoginAt: fmtJstDateTime(data.last_accessed_at),
      accessCount: typeof data.access_count === "number" ? data.access_count : null,
      viewsDaily: buildViewsDaily(Array.isArray(data.views_daily_30d) ? data.views_daily_30d : []),
    };
  } catch {
    return { lastLoginAt: null, accessCount: null, viewsDaily: buildViewsDaily([]) };
  }
}

// 選考ステージ集合（entryFlag）
const ENTRY_FLAGS = new Set(["エントリー", "書類選考", "面接", "内定", "入社済"]); // 実エントリー（求人紹介止まりを除く）
const DOC_PLUS_FLAGS = new Set(["書類選考", "面接", "内定", "入社済"]); // 書類選考以降
const FIRST_PLUS_FLAGS = new Set(["面接", "内定", "入社済"]); // 一次面接以降（内定/入社済も一次は通過済みとみなしファネルの単調性を保つ）
const IN_SELECTION_FLAGS = new Set(["書類選考", "面接", "内定"]); // 選考中ステージ（入社済は除外）

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { candidateId } = await params;
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });
  if (!candidate) return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });

  const [
    mypage,
    entries,
    responses,
    latestInterview,
    notesAgg,
    bookmarkAgg,
    bookmarkCount,
    openTasks,
  ] = await Promise.all([
    fetchMypageStats(candidate.candidateNumber),
    prisma.jobEntry.findMany({
      where: { candidateId },
      select: {
        companyName: true, entryFlag: true, entryFlagDetail: true, isActive: true, archivedAt: true,
        entryDate: true, documentSubmitDate: true, documentPassDate: true,
        firstInterviewDate: true, secondInterviewDate: true, finalInterviewDate: true,
      },
    }),
    prisma.candidateJobResponse.groupBy({ by: ["response"], where: { candidateId }, _count: { _all: true } }),
    prisma.interviewRecord.findFirst({
      where: { candidateId },
      orderBy: { interviewDate: "desc" },
      select: { interviewDate: true, detail: { select: { nextInterviewDate: true } } },
    }),
    prisma.candidateNote.aggregate({ where: { candidateId }, _max: { createdAt: true } }),
    prisma.candidateFile.aggregate({
      where: { candidateId, category: "BOOKMARK", lastExportedAt: { not: null } },
      _max: { lastExportedAt: true },
    }),
    prisma.candidateFile.count({ where: { candidateId, category: "BOOKMARK", lastExportedAt: { not: null } } }),
    prisma.task.findMany({
      where: { candidateId, status: { not: "COMPLETED" }, dueDate: { not: null } },
      select: { dueDate: true },
    }),
  ]);

  /* ----- ①本人の動き ----- */
  const interestedCount = responses.find((r) => r.response === "INTERESTED")?._count._all ?? 0;
  const wantToApplyCount = responses.find((r) => r.response === "WANT_TO_APPLY")?._count._all ?? 0;

  /* ----- ②こちらの対応 ----- */
  const bookmarkMaxExport = bookmarkAgg._max.lastExportedAt ?? null;
  const maxEntryDate = entries.reduce<Date | null>((m, e) => (e.entryDate && (!m || e.entryDate > m) ? e.entryDate : m), null);
  // 最終求人提案日 = BOOKMARK送信日 と 求人紹介(JobEntry)記録日 の新しい方
  const lastProposal = maxDate(bookmarkMaxExport, maxEntryDate);
  const deliveryCount = bookmarkCount;

  /* ----- 信号バー: 最終接触 / 放置日数 / 次回連絡 ----- */
  // 最終接触日 = 面談実施 / 連絡メモ / 求人提案(送信) の最新（タスク完了は含めない）
  const lastContact = maxDate(latestInterview?.interviewDate ?? null, notesAgg._max.createdAt ?? null, bookmarkMaxExport);
  const todayStr = todayJstDateString();
  const lastContactJst = lastContact ? toJstDateString(lastContact) : null;
  const idleDays = lastContactJst ? diffJstDays(todayStr, lastContactJst) : null;

  // 次回連絡予定日 = 最新面談の次回予定 と 未完了タスク期限 のうち「今日以降で最も近い日」
  const nextCandidates: string[] = [];
  if (latestInterview?.detail?.nextInterviewDate) nextCandidates.push(toJstDateString(latestInterview.detail.nextInterviewDate));
  for (const t of openTasks) if (t.dueDate) nextCandidates.push(toJstDateString(t.dueDate));
  const futureNext = nextCandidates.filter((s) => s >= todayStr).sort();
  const nextContactStr = futureNext.length > 0 ? futureNext[0].replace(/-/g, "/") : null;

  /* ----- ③選考の進み（会社単位 distinct） ----- */
  const distinctCompanies = (pred: (e: (typeof entries)[number]) => boolean) =>
    new Set(entries.filter(pred).map((e) => e.companyName)).size;

  const entryCompanies = distinctCompanies((e) => ENTRY_FLAGS.has(e.entryFlag ?? ""));
  const inSelectionCompanies = distinctCompanies(
    (e) =>
      IN_SELECTION_FLAGS.has(e.entryFlag ?? "") &&
      !SELECTION_ENDED_DETAILS.includes(e.entryFlagDetail ?? "") &&
      e.isActive &&
      !e.archivedAt,
  );

  // 選考ファネル（到達社数・会社単位 distinct）
  const funnel = {
    entry: entryCompanies,
    doc: distinctCompanies((e) => e.documentSubmitDate != null || DOC_PLUS_FLAGS.has(e.entryFlag ?? "")),
    first: distinctCompanies((e) => e.firstInterviewDate != null || FIRST_PLUS_FLAGS.has(e.entryFlag ?? "")),
    second: distinctCompanies((e) => e.secondInterviewDate != null),
    offer: distinctCompanies((e) => e.entryFlag === "内定" || e.entryFlag === "入社済" || e.finalInterviewDate != null),
  };

  // 通過率（次段階到達 ÷ 当該段階到達）。母数3社未満は null。%（小数1桁）。
  const rate = (numer: number, denom: number): number | null =>
    denom < 3 ? null : Math.round((numer / denom) * 1000) / 10;
  const passRate = {
    doc: rate(funnel.first, funnel.doc),
    first: rate(funnel.second, funnel.first),
    second: rate(funnel.offer, funnel.second),
  };

  // 選考段階の内訳: 選考継続中の社を「現ステージ」で排他分類（会社単位 distinct・最も進んだ段階で1社1分類）。
  // 落ち・辞退・クローズ(SELECTION_ENDED_DETAILS)・無効・アーカイブ済みは除外（選考継続中社数と整合）。
  const stageRank = (e: (typeof entries)[number]): number => {
    if (e.entryFlag === "内定" || e.entryFlag === "入社済") return 4; // 内定
    if (e.entryFlag === "面接") return e.secondInterviewDate != null ? 3 : 2; // 二次 / 一次
    if (e.entryFlag === "書類選考") return 1; // 書類選考
    return 0;
  };
  const companyStage = new Map<string, number>();
  for (const e of entries) {
    if (SELECTION_ENDED_DETAILS.includes(e.entryFlagDetail ?? "")) continue;
    if (!e.isActive || e.archivedAt) continue;
    const r = stageRank(e);
    if (r > 0) companyStage.set(e.companyName, Math.max(companyStage.get(e.companyName) ?? 0, r));
  }
  const stageBreakdown = { document: 0, first: 0, second: 0, offer: 0 };
  for (const r of companyStage.values()) {
    if (r === 4) stageBreakdown.offer++;
    else if (r === 3) stageBreakdown.second++;
    else if (r === 2) stageBreakdown.first++;
    else if (r === 1) stageBreakdown.document++;
  }

  return NextResponse.json({
    // 閲覧系（kyuujinPDF）
    lastLoginAt: mypage.lastLoginAt, // JST "YYYY/MM/DD HH:mm" | null
    mypageAccessCount: mypage.accessCount, // 累計 | null
    viewsDaily: mypage.viewsDaily, // 過去30日（JST日付・0埋め・昇順）[{date,count}]
    // 信号
    idleDays, // 日数 | null
    lastContactDate: fmtJstDate(lastContact),
    nextContactDate: nextContactStr,
    // ①本人の動き
    interestedCount,
    wantToApplyCount,
    // ②こちらの対応
    lastProposalDate: fmtJstDate(lastProposal),
    deliveryCount,
    // ③選考の進み
    entryCompanies,
    inSelectionCompanies,
    funnel,
    passRate, // %（doc/first/second）| null（母数<3）
    stageBreakdown, // 選考継続中の現ステージ内訳（会社単位 distinct・排他）
  });
}

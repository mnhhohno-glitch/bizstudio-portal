// T-XXX step2: /api/ai/ca-kpi の集計本体（CA別 × 期間区切り）。読み取りのみ。
//
// 数え方は実績表の正本 computeWeeklyMatrix（src/lib/performance/weeklyMatrix.ts）に揃える。
//   - 担当軸は candidates.employee_id（求職者の「今の」担当CA）。履歴（CandidateCaAssignmentHistory）は使わない。
//   - 面談: notDeclined（辞退系以外・null 含む）かつ interview_count >= 1。初回= interview_count = 1、既存= >= 2。
//   - 求人紹介: proposalEventsSql（JobEntry.jobIntroDate ∪ BOOKMARK の COALESCE(出力日, 紹介日)）をそのまま使う。
//   - エントリー: entryEventsSql（entry_flag が有効値・archived 除く）をそのまま使う。
//   - 選考段階: job_entries の各 *_date が区切り内にある行（件数= COUNT(*)、人数= COUNT(DISTINCT candidate_id)）。
//     computeWeeklyMatrix の documentPass/offer/acceptance と同じ述語（archived_at IS NULL・担当軸）。
//   - 企業面接の人数: 一次/二次/最終のいずれかが区切り内の求職者ユニーク（src/lib/aiRead/kpi.ts と同じ）。
// 期間の区切りは SQL 側で VALUES の表（key, f, t）と JOIN して GROUP BY する。1 グループ 1 クエリで全区切り×全CAを一度に出す
//   （CA × 区切りごとに computeWeeklyMatrix を呼ぶと day 粒度で数千クエリになり ChatGPT Actions の応答時間に収まらないため）。
// 日付列は timestamp(無tz・UTC 保存) なので、区切りの境界は tsLit（UTC wall-clock リテラル）で渡す（weeklyMatrix.ts と同じ）。
// 「全員」は GROUPING SETS で同じクエリから出す（全求職者が母集団。担当なし・CA職種以外の担当も含む＝company-kpi の allCas と同じ）。
//
// 2026-08・全CA の値が computeWeeklyMatrix と一致することは scripts/verify-ca-kpi-t-xxx-step2.ts で確かめる。

import { prisma } from "@/lib/prisma";
import {
  tsLit,
  DECLINED_SQL,
  ENTRY_FLAGS_COUNTED_SQL,
  proposalEventsSql,
  entryEventsSql,
} from "@/lib/performance/weeklyMatrix";
import { INTERVIEW_TYPE_INTERVIEW_PREP } from "@/lib/dailyReport/constants";
import { jstDateStart, jstDateEnd } from "@/lib/dailyReport/jstDate";
import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";
import { NOTIFIED_REJECTION_PERSON_FLAGS } from "@/lib/entries/selection-status-label";
import type { CaKpiBucket, CaKpiGroup } from "@/lib/aiRead/caKpiParams";

/** 「全員」行のキー（employee_id は cuid なので衝突しない）。 */
export const CA_KPI_ALL = "ALL";
/** 担当なし（employee_id IS NULL）の求職者をまとめるキー。全員行には含まれる。 */
export const CA_KPI_NONE = "";

export interface RecsUniq {
  records: number;
  candidates: number;
}

export interface CaKpiMetrics {
  interview?: {
    total: number;
    first: number;
    existing: number;
    interviewPrep: number;
    booked: number;
    noShow: number;
    cancelled: number;
    rescheduled: number;
    minutesTotal: number;
    minutesKnown: number;
    minutesAvg: number | null;
  };
  interviewRank?: Record<"S" | "A+" | "A" | "B+" | "B" | "C" | "D" | "unrated", number>;
  proposal?: RecsUniq;
  bookmark?: { created: number; createdAuto: number; introduced: number };
  bookmarkRatingCurrent?: Record<"A" | "B+" | "B" | "C" | "D" | "unrated", number>;
  aiRatingHistory?: Record<"A" | "B+" | "B" | "C" | "D" | "other", number>;
  entry?: RecsUniq;
  entryOutcomeNow?: { declined: number; rejected: number; closed: number };
  selection?: Record<SelectionStage, RecsUniq>;
  activity?: {
    tasksCreated: number;
    documentTasksCreated: number;
    advisorChatSessions: number;
    interviewPrepRooms: number;
    dailyReports: number;
    contactMails: number;
  };
}

export const SELECTION_STAGES = [
  "documentSubmit",
  "documentPass",
  "firstInterview",
  "secondInterview",
  "finalInterview",
  "companyInterview",
  "offer",
  "acceptance",
  "join",
] as const;
export type SelectionStage = (typeof SELECTION_STAGES)[number];

const STAGE_COLUMNS: Record<Exclude<SelectionStage, "companyInterview">, string> = {
  documentSubmit: "document_submit_date",
  documentPass: "document_pass_date",
  firstInterview: "first_interview_date",
  secondInterview: "second_interview_date",
  finalInterview: "final_interview_date",
  offer: "offer_date",
  acceptance: "acceptance_date",
  join: "join_date",
};

export const CURRENT_STATUS_STAGES = [
  "entered",
  "documentScreening",
  "firstInterview",
  "secondInterview",
  "finalInterview",
  "interviewOther",
  "offered",
  "acceptedNotJoined",
  "joined",
  "declined",
  "rejected",
  "closed",
] as const;
export type CurrentStatusStage = (typeof CURRENT_STATUS_STAGES)[number];
export type CurrentStatusCounts = Record<CurrentStatusStage, number>;

export interface CaKpiScope {
  /** null = 全員（全員行＋担当ごとの行） / 指定時はその担当だけ */
  employeeId: string | null;
  /** activity グループ用（CA に対応する User.id）。null で activity を数えない */
  userId: string | null;
}

export interface CaKpiResult {
  /** grp（employee_id / "ALL" / ""）→ bucket key → metrics */
  rows: Map<string, Map<string, CaKpiMetrics>>;
  /** grp → 現在の選考状況（期間に依存しない） */
  currentStatus: Map<string, CurrentStatusCounts>;
}

// ---- SQL 部品 ---------------------------------------------------------------

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const inList = (xs: readonly string[]) => xs.map(sqlStr).join(",");

/** 区切りの表（key, f, t）。key は this module が作る値のみ（ユーザー入力をそのまま入れない）。 */
function bucketsCte(buckets: CaKpiBucket[]): string {
  const rows = buckets
    .map((b) => `(${sqlStr(b.key)}, TIMESTAMP '${tsLit(jstDateStart(b.from))}', TIMESTAMP '${tsLit(jstDateEnd(b.to))}')`)
    .join(",\n        ");
  return `b(key, f, t) AS (VALUES ${rows})`;
}

/** GROUPING SETS で「全員」と「担当ごと」を同時に出すときのキー列。 */
function grpExpr(col: string): string {
  return `CASE WHEN GROUPING(${col}) = 1 THEN '${CA_KPI_ALL}' ELSE COALESCE(${col}, '${CA_KPI_NONE}') END AS grp`;
}

/** 担当軸の述語。employeeId は DB から引いた Employee.id（cuid）だけを渡す。 */
function empPredOf(employeeId: string | null): string {
  if (employeeId == null) return "TRUE";
  if (!/^[A-Za-z0-9_-]+$/.test(employeeId)) throw new Error("invalid employeeId");
  return `c.employee_id = '${employeeId}'`;
}

const DECLINED_DETAILS = SELECTION_ENDED_DETAILS.filter((d) => d.startsWith("本人辞退"));
const CLOSED_DETAILS = SELECTION_ENDED_DETAILS.filter((d) => d.endsWith("クローズ"));
const REJECTED_DETAILS = SELECTION_ENDED_DETAILS.filter((d) => d === "選考落ち");

/**
 * 今の entry_flag / entry_flag_detail / person_flag / company_flag から「辞退・見送り・クローズ」を判定する CASE。
 * 判定順: 詳細（entry_flag_detail）→ 本人へ見送り通知済み（person_flag）→ 本人辞退の受付・企業への辞退報告。
 */
function endedKindCase(): string {
  return `CASE
        WHEN je.entry_flag_detail IN (${inList(DECLINED_DETAILS)}) THEN 'declined'
        WHEN je.entry_flag_detail IN (${inList(REJECTED_DETAILS)}) THEN 'rejected'
        WHEN je.entry_flag_detail IN (${inList(CLOSED_DETAILS)}) THEN 'closed'
        WHEN je.person_flag IN (${inList(NOTIFIED_REJECTION_PERSON_FLAGS)}) THEN 'rejected'
        WHEN je.person_flag = '辞退受付済' OR je.company_flag = '辞退報告済' THEN 'declined'
      END`;
}

// ---- 各グループのクエリ ------------------------------------------------------

type Row = Record<string, unknown> & { key?: string; grp: string };

async function q<T extends Row>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

const n = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));

async function queryInterview(bCte: string, empPred: string) {
  // 時刻は "HH:MM" または "HH:MM:SS" の文字列。::time に通さず、時・分を整数で取り出して引き算する（範囲外の値で落とさない）。
  const TIME_RE = "'^[0-9]{1,2}:[0-9]{2}'";
  const toMin = (col: string) => `(split_part(${col}, ':', 1)::int * 60 + split_part(${col}, ':', 2)::int)`;
  return q<Row>(`
    WITH ${bCte},
    iv AS (
      SELECT ir.candidate_id, ir.interview_date, ir.interview_count, ir.result_flag, ir.interview_type,
        (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL})) AS held,
        CASE WHEN ir.start_time ~ ${TIME_RE} AND ir.end_time ~ ${TIME_RE}
             THEN ${toMin("ir.end_time")} - ${toMin("ir.start_time")}
        END AS mins,
        COALESCE(NULLIF(rt.overall_rank, ''), '未評価') AS rk
      FROM interview_records ir
      LEFT JOIN interview_ratings rt ON rt.interview_record_id = ir.id
    )
    SELECT b.key, ${grpExpr("c.employee_id")},
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count >= 1)::int AS total,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1)::int AS first_cnt,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count >= 2)::int AS existing_cnt,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count >= 1 AND iv.interview_type = ${sqlStr(INTERVIEW_TYPE_INTERVIEW_PREP)})::int AS prep,
      COUNT(*)::int AS booked,
      COUNT(*) FILTER (WHERE iv.result_flag = '連絡なし辞退')::int AS no_show,
      COUNT(*) FILTER (WHERE iv.result_flag IN ('連絡あり辞退','辞退'))::int AS cancelled,
      COUNT(*) FILTER (WHERE iv.result_flag = '日程再調整')::int AS rescheduled,
      COALESCE(SUM(iv.mins) FILTER (WHERE iv.held AND iv.interview_count >= 1 AND iv.mins > 0), 0)::int AS minutes_total,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count >= 1 AND iv.mins > 0)::int AS minutes_known,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'S')::int AS rk_s,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'A+')::int AS rk_a_plus,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'A')::int AS rk_a,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'B+')::int AS rk_b_plus,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'B')::int AS rk_b,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'C')::int AS rk_c,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk = 'D')::int AS rk_d,
      COUNT(*) FILTER (WHERE iv.held AND iv.interview_count = 1 AND iv.rk NOT IN ('S','A+','A','B+','B','C','D'))::int AS rk_unrated
    FROM iv
    JOIN candidates c ON c.id = iv.candidate_id
    JOIN b ON iv.interview_date BETWEEN b.f AND b.t
    WHERE ${empPred}
    GROUP BY GROUPING SETS ((b.key, c.employee_id), (b.key));`);
}

async function queryProposal(bCte: string, empPred: string) {
  return q<Row>(`
    WITH ${bCte},
    events AS (${proposalEventsSql(empPred)})
    SELECT b.key, ${grpExpr("c2.employee_id")},
      COUNT(*)::int AS recs, COUNT(DISTINCT e.candidate_id)::int AS uniq
    FROM events e
    JOIN candidates c2 ON c2.id = e.candidate_id
    JOIN b ON e.pdate BETWEEN b.f AND b.t
    GROUP BY GROUPING SETS ((b.key, c2.employee_id), (b.key));`);
}

async function queryBookmark(bCte: string, empPred: string) {
  return q<Row>(`
    WITH ${bCte},
    ev AS (
      SELECT cf.candidate_id, c.employee_id, 'created' AS kind, cf.created_at AS d,
        cf.ai_match_rating AS rating, (cf.auto_sourced_at IS NOT NULL) AS is_auto
      FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id
      WHERE ${empPred} AND cf.category = 'BOOKMARK'
      UNION ALL
      SELECT cf.candidate_id, c.employee_id, 'introduced' AS kind, cf.introduced_at AS d,
        NULL::text AS rating, FALSE AS is_auto
      FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id
      WHERE ${empPred} AND cf.category = 'BOOKMARK' AND cf.introduced_at IS NOT NULL
    )
    SELECT b.key, ${grpExpr("ev.employee_id")},
      COUNT(*) FILTER (WHERE ev.kind = 'created')::int AS created,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND ev.is_auto)::int AS created_auto,
      COUNT(*) FILTER (WHERE ev.kind = 'introduced')::int AS introduced,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND ev.rating = 'A')::int AS r_a,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND ev.rating = 'B+')::int AS r_b_plus,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND ev.rating = 'B')::int AS r_b,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND ev.rating = 'C')::int AS r_c,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND ev.rating = 'D')::int AS r_d,
      COUNT(*) FILTER (WHERE ev.kind = 'created' AND (ev.rating IS NULL OR ev.rating NOT IN ('A','B+','B','C','D')))::int AS r_unrated
    FROM ev
    JOIN b ON ev.d BETWEEN b.f AND b.t
    GROUP BY GROUPING SETS ((b.key, ev.employee_id), (b.key));`);
}

async function queryEvalHistory(bCte: string, empPred: string) {
  // job_eval_records: AI評価の履歴（2026-09-25〜）。status='SAVED'＝新しく評価した行だけ（REUSED は前回の流用・PENDING/FAILED/SKIPPED は結果なし）。
  return q<Row>(`
    WITH ${bCte}
    SELECT b.key, ${grpExpr("c.employee_id")},
      COUNT(*) FILTER (WHERE jer.overall_rating = 'A')::int AS r_a,
      COUNT(*) FILTER (WHERE jer.overall_rating = 'B+')::int AS r_b_plus,
      COUNT(*) FILTER (WHERE jer.overall_rating = 'B')::int AS r_b,
      COUNT(*) FILTER (WHERE jer.overall_rating = 'C')::int AS r_c,
      COUNT(*) FILTER (WHERE jer.overall_rating = 'D')::int AS r_d,
      COUNT(*) FILTER (WHERE jer.overall_rating NOT IN ('A','B+','B','C','D'))::int AS r_other
    FROM job_eval_records jer
    JOIN candidates c ON c.id = jer.candidate_id
    JOIN b ON COALESCE(jer.evaluated_at, jer.created_at) BETWEEN b.f AND b.t
    WHERE ${empPred} AND jer.status = 'SAVED' AND jer.overall_rating IS NOT NULL
    GROUP BY GROUPING SETS ((b.key, c.employee_id), (b.key));`);
}

async function queryEntry(bCte: string, empPred: string) {
  return q<Row>(`
    WITH ${bCte},
    events AS (${entryEventsSql(empPred)})
    SELECT b.key, ${grpExpr("c2.employee_id")},
      COUNT(*)::int AS recs, COUNT(DISTINCT e.candidate_id)::int AS uniq
    FROM events e
    JOIN candidates c2 ON c2.id = e.candidate_id
    JOIN b ON e.pdate BETWEEN b.f AND b.t
    GROUP BY GROUPING SETS ((b.key, c2.employee_id), (b.key));`);
}

async function queryEntryOutcomeNow(bCte: string, empPred: string) {
  // エントリー日が区切り内の行について「今の時点で」辞退・見送り・クローズになっている件数（母集団は entryEventsSql と同じ）。
  return q<Row>(`
    WITH ${bCte},
    ev AS (
      SELECT je.candidate_id, c.employee_id, je.entry_date, ${endedKindCase()} AS ended
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL AND je.entry_date IS NOT NULL
        AND je.entry_flag IN (${ENTRY_FLAGS_COUNTED_SQL})
    )
    SELECT b.key, ${grpExpr("ev.employee_id")},
      COUNT(*) FILTER (WHERE ev.ended = 'declined')::int AS declined,
      COUNT(*) FILTER (WHERE ev.ended = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE ev.ended = 'closed')::int AS closed
    FROM ev
    JOIN b ON ev.entry_date BETWEEN b.f AND b.t
    GROUP BY GROUPING SETS ((b.key, ev.employee_id), (b.key));`);
}

async function querySelection(bCte: string, empPred: string) {
  const parts: string[] = [];
  for (const [stage, col] of Object.entries(STAGE_COLUMNS)) {
    parts.push(`
      SELECT je.candidate_id, c.employee_id, '${stage}' AS stage, je.${col} AS d
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL AND je.${col} IS NOT NULL`);
  }
  // 企業面接（一次・二次・最終のいずれか）: 人数は kpi.ts countCompanyInterviewCandidates と同じ定義になる。
  for (const col of ["first_interview_date", "second_interview_date", "final_interview_date"]) {
    parts.push(`
      SELECT je.candidate_id, c.employee_id, 'companyInterview' AS stage, je.${col} AS d
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL AND je.${col} IS NOT NULL`);
  }
  return q<Row>(`
    WITH ${bCte},
    ev AS (${parts.join("\n      UNION ALL")}
    )
    SELECT b.key, ${grpExpr("ev.employee_id")}, ev.stage,
      COUNT(*)::int AS recs, COUNT(DISTINCT ev.candidate_id)::int AS uniq
    FROM ev
    JOIN b ON ev.d BETWEEN b.f AND b.t
    GROUP BY GROUPING SETS ((b.key, ev.employee_id, ev.stage), (b.key, ev.stage));`);
}

async function queryCurrentStatus(empPred: string) {
  return q<Row>(`
    SELECT ${grpExpr("x.employee_id")}, x.stage, COUNT(*)::int AS n
    FROM (
      SELECT c.employee_id,
        CASE
          WHEN je.entry_flag_detail IN (${inList(DECLINED_DETAILS)}) THEN 'declined'
          WHEN je.entry_flag_detail IN (${inList(REJECTED_DETAILS)}) THEN 'rejected'
          WHEN je.entry_flag_detail IN (${inList(CLOSED_DETAILS)}) THEN 'closed'
          WHEN je.person_flag IN (${inList(NOTIFIED_REJECTION_PERSON_FLAGS)}) THEN 'rejected'
          WHEN je.person_flag = '辞退受付済' OR je.company_flag = '辞退報告済' THEN 'declined'
          WHEN je.entry_flag = '入社済' OR je.person_flag = '入社済' THEN 'joined'
          WHEN je.entry_flag = '内定' AND je.acceptance_date IS NOT NULL THEN 'acceptedNotJoined'
          WHEN je.entry_flag = '内定' THEN 'offered'
          WHEN je.entry_flag = '面接' AND je.entry_flag_detail LIKE '最終%' THEN 'finalInterview'
          WHEN je.entry_flag = '面接' AND je.entry_flag_detail LIKE '二次%' THEN 'secondInterview'
          WHEN je.entry_flag = '面接' AND je.entry_flag_detail LIKE '一次%' THEN 'firstInterview'
          WHEN je.entry_flag = '面接' THEN 'interviewOther'
          WHEN je.entry_flag = '書類選考' THEN 'documentScreening'
          WHEN je.entry_flag IN ('応募','エントリー') THEN 'entered'
        END AS stage
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL
    ) x
    WHERE x.stage IS NOT NULL
    GROUP BY GROUPING SETS ((x.employee_id, x.stage), (x.stage));`);
}

async function queryActivity(bCte: string, userId: string | null) {
  if (userId != null && !/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("invalid userId");
  const userPred = userId == null ? "TRUE" : `ev.user_id = '${userId}'`;
  return q<Row>(`
    WITH ${bCte},
    ev AS (
      SELECT t.created_by_user_id AS user_id, 'task' AS kind, t.created_at AS d,
        (tc.name IN ('履歴書作成','職務経歴書作成','推薦状作成')) AS is_doc
      FROM tasks t LEFT JOIN task_categories tc ON tc.id = t.category_id
      UNION ALL
      SELECT s.created_by_user_id, 'advisorChat', s.created_at, FALSE FROM advisor_chat_sessions s
      UNION ALL
      SELECT r.created_by_user_id, 'prepRoom', r.created_at, FALSE FROM interview_prep_rooms r
      UNION ALL
      SELECT d.user_id, 'dailyReport', d.date::timestamp, FALSE FROM daily_reports d
      UNION ALL
      SELECT m.sent_by_user_id, 'contactMail', m.sent_at, FALSE FROM candidate_contact_mail_logs m
    )
    SELECT b.key, CASE WHEN GROUPING(ev.user_id) = 1 THEN '${CA_KPI_ALL}' ELSE ev.user_id END AS grp,
      COUNT(*) FILTER (WHERE ev.kind = 'task')::int AS tasks,
      COUNT(*) FILTER (WHERE ev.kind = 'task' AND ev.is_doc)::int AS doc_tasks,
      COUNT(*) FILTER (WHERE ev.kind = 'advisorChat')::int AS advisor_chat,
      COUNT(*) FILTER (WHERE ev.kind = 'prepRoom')::int AS prep_rooms,
      COUNT(*) FILTER (WHERE ev.kind = 'dailyReport')::int AS daily_reports,
      COUNT(*) FILTER (WHERE ev.kind = 'contactMail')::int AS contact_mails
    FROM ev
    JOIN b ON ev.d BETWEEN b.f AND b.t
    WHERE ${userPred}
    GROUP BY GROUPING SETS ((b.key, ev.user_id), (b.key));`);
}

// ---- 組み立て ---------------------------------------------------------------

function emptyMetrics(groups: readonly CaKpiGroup[]): CaKpiMetrics {
  const m: CaKpiMetrics = {};
  if (groups.includes("interview")) {
    m.interview = {
      total: 0, first: 0, existing: 0, interviewPrep: 0, booked: 0, noShow: 0, cancelled: 0, rescheduled: 0,
      minutesTotal: 0, minutesKnown: 0, minutesAvg: null,
    };
  }
  if (groups.includes("proposal")) {
    m.proposal = { records: 0, candidates: 0 };
    m.bookmark = { created: 0, createdAuto: 0, introduced: 0 };
  }
  if (groups.includes("rating")) {
    m.interviewRank = { S: 0, "A+": 0, A: 0, "B+": 0, B: 0, C: 0, D: 0, unrated: 0 };
    m.bookmarkRatingCurrent = { A: 0, "B+": 0, B: 0, C: 0, D: 0, unrated: 0 };
    m.aiRatingHistory = { A: 0, "B+": 0, B: 0, C: 0, D: 0, other: 0 };
  }
  if (groups.includes("entry")) {
    m.entry = { records: 0, candidates: 0 };
    m.entryOutcomeNow = { declined: 0, rejected: 0, closed: 0 };
  }
  if (groups.includes("selection")) {
    m.selection = Object.fromEntries(SELECTION_STAGES.map((s) => [s, { records: 0, candidates: 0 }])) as Record<SelectionStage, RecsUniq>;
  }
  if (groups.includes("activity")) {
    m.activity = { tasksCreated: 0, documentTasksCreated: 0, advisorChatSessions: 0, interviewPrepRooms: 0, dailyReports: 0, contactMails: 0 };
  }
  return m;
}

export function emptyCurrentStatus(): CurrentStatusCounts {
  return Object.fromEntries(CURRENT_STATUS_STAGES.map((s) => [s, 0])) as CurrentStatusCounts;
}

/**
 * 集計本体。rows は「区切り×担当」のうち値のある組だけを持つ。無い組は呼び出し側で emptyMetrics を使う。
 * activity は user 軸なので grp に User.id が入る（呼び出し側で Employee.userId に読み替える）。
 */
export async function computeCaKpi(params: {
  buckets: CaKpiBucket[];
  groups: readonly CaKpiGroup[];
  scope: CaKpiScope;
}): Promise<CaKpiResult & { activityByUser: Map<string, Map<string, NonNullable<CaKpiMetrics["activity"]>>> }> {
  const { buckets, groups, scope } = params;
  const bCte = bucketsCte(buckets);
  const empPred = empPredOf(scope.employeeId);
  const want = (g: CaKpiGroup) => groups.includes(g);

  const rows = new Map<string, Map<string, CaKpiMetrics>>();
  const get = (grp: string, key: string): CaKpiMetrics => {
    let byKey = rows.get(grp);
    if (!byKey) {
      byKey = new Map();
      rows.set(grp, byKey);
    }
    let m = byKey.get(key);
    if (!m) {
      m = emptyMetrics(groups);
      byKey.set(key, m);
    }
    return m;
  };

  const [iv, prop, bm, evh, ent, out, sel, cur, act] = await Promise.all([
    want("interview") || want("rating") ? queryInterview(bCte, empPred) : Promise.resolve([] as Row[]),
    want("proposal") ? queryProposal(bCte, empPred) : Promise.resolve([] as Row[]),
    want("proposal") || want("rating") ? queryBookmark(bCte, empPred) : Promise.resolve([] as Row[]),
    want("rating") ? queryEvalHistory(bCte, empPred) : Promise.resolve([] as Row[]),
    want("entry") ? queryEntry(bCte, empPred) : Promise.resolve([] as Row[]),
    want("entry") ? queryEntryOutcomeNow(bCte, empPred) : Promise.resolve([] as Row[]),
    want("selection") ? querySelection(bCte, empPred) : Promise.resolve([] as Row[]),
    queryCurrentStatus(empPred),
    want("activity") && (scope.employeeId == null || scope.userId != null)
      ? queryActivity(bCte, scope.userId)
      : Promise.resolve([] as Row[]),
  ]);

  for (const r of iv) {
    const m = get(r.grp, r.key as string);
    if (m.interview) {
      const total = n(r.total);
      const known = n(r.minutes_known);
      const mins = n(r.minutes_total);
      m.interview = {
        total,
        first: n(r.first_cnt),
        existing: n(r.existing_cnt),
        interviewPrep: n(r.prep),
        booked: n(r.booked),
        noShow: n(r.no_show),
        cancelled: n(r.cancelled),
        rescheduled: n(r.rescheduled),
        minutesTotal: mins,
        minutesKnown: known,
        minutesAvg: known > 0 ? Math.round((mins / known) * 10) / 10 : null,
      };
    }
    if (m.interviewRank) {
      m.interviewRank = {
        S: n(r.rk_s), "A+": n(r.rk_a_plus), A: n(r.rk_a), "B+": n(r.rk_b_plus), B: n(r.rk_b), C: n(r.rk_c), D: n(r.rk_d),
        unrated: n(r.rk_unrated),
      };
    }
  }
  for (const r of prop) {
    const m = get(r.grp, r.key as string);
    m.proposal = { records: n(r.recs), candidates: n(r.uniq) };
  }
  for (const r of bm) {
    const m = get(r.grp, r.key as string);
    if (m.bookmark) m.bookmark = { created: n(r.created), createdAuto: n(r.created_auto), introduced: n(r.introduced) };
    if (m.bookmarkRatingCurrent) {
      m.bookmarkRatingCurrent = { A: n(r.r_a), "B+": n(r.r_b_plus), B: n(r.r_b), C: n(r.r_c), D: n(r.r_d), unrated: n(r.r_unrated) };
    }
  }
  for (const r of evh) {
    const m = get(r.grp, r.key as string);
    m.aiRatingHistory = { A: n(r.r_a), "B+": n(r.r_b_plus), B: n(r.r_b), C: n(r.r_c), D: n(r.r_d), other: n(r.r_other) };
  }
  for (const r of ent) {
    const m = get(r.grp, r.key as string);
    m.entry = { records: n(r.recs), candidates: n(r.uniq) };
  }
  for (const r of out) {
    const m = get(r.grp, r.key as string);
    m.entryOutcomeNow = { declined: n(r.declined), rejected: n(r.rejected), closed: n(r.closed) };
  }
  for (const r of sel) {
    const m = get(r.grp, r.key as string);
    const stage = r.stage as SelectionStage;
    if (m.selection && stage in m.selection) m.selection[stage] = { records: n(r.recs), candidates: n(r.uniq) };
  }

  const currentStatus = new Map<string, CurrentStatusCounts>();
  for (const r of cur) {
    let c = currentStatus.get(r.grp);
    if (!c) {
      c = emptyCurrentStatus();
      currentStatus.set(r.grp, c);
    }
    const stage = r.stage as CurrentStatusStage;
    if (stage in c) c[stage] = n(r.n);
  }

  const activityByUser = new Map<string, Map<string, NonNullable<CaKpiMetrics["activity"]>>>();
  for (const r of act) {
    let byKey = activityByUser.get(r.grp);
    if (!byKey) {
      byKey = new Map();
      activityByUser.set(r.grp, byKey);
    }
    byKey.set(r.key as string, {
      tasksCreated: n(r.tasks),
      documentTasksCreated: n(r.doc_tasks),
      advisorChatSessions: n(r.advisor_chat),
      interviewPrepRooms: n(r.prep_rooms),
      dailyReports: n(r.daily_reports),
      contactMails: n(r.contact_mails),
    });
  }

  return { rows, currentStatus, activityByUser };
}

/** 値のない組を既定値で埋めて取り出す。 */
export function metricsFor(result: CaKpiResult, grp: string, key: string, groups: readonly CaKpiGroup[]): CaKpiMetrics {
  return result.rows.get(grp)?.get(key) ?? emptyMetrics(groups);
}

/** データの鮮度（各テーブルの最終更新）と担当CA記録の開始日時。 */
export async function queryCaKpiMeta(): Promise<{
  interviewRecordsUpdatedAt: Date | null;
  jobEntriesUpdatedAt: Date | null;
  candidateFilesUpdatedAt: Date | null;
  caAssignmentHistorySince: Date | null;
}> {
  const rows = await prisma.$queryRawUnsafe<
    { ir: Date | null; je: Date | null; cf: Date | null; hist: Date | null }[]
  >(`
    SELECT
      (SELECT MAX(updated_at) FROM interview_records) AS ir,
      (SELECT MAX(updated_at) FROM job_entries) AS je,
      (SELECT MAX(updated_at) FROM candidate_files) AS cf,
      (SELECT MIN(changed_at) FROM candidate_ca_assignment_histories) AS hist;`);
  const r = rows[0];
  return {
    interviewRecordsUpdatedAt: r?.ir ?? null,
    jobEntriesUpdatedAt: r?.je ?? null,
    candidateFilesUpdatedAt: r?.cf ?? null,
    caAssignmentHistorySince: r?.hist ?? null,
  };
}

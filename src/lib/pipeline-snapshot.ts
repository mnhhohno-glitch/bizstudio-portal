// T-XXX step5B: 進行中案件の日次スナップショット（ca_pipeline_daily_snapshots）。
//
// - 1 日 1 回、取得時点の「活動中の求職者数・選考中の案件を段階別に・承諾済み未入社・今後の面談予約数」を CA 別の集計値で保存する。
//   個人の行は保存しない。過去の日付は作らない（記録は本番反映日から始まる）。
// - 同じ日に 2 回動いても重複しない（snapshot_date × ca_key で upsert・run_count を +1）。
// - 実行は GitHub Actions（.github/workflows/t-xxx-pipeline-snapshot.yml・23:50 JST）→ POST /api/internal/pipeline-snapshot。
//   既存の定期処理（auto-expire / due-reminder 等）と同じ作法（x-api-key = INTERNAL_API_KEY・dry_run）。
// - 数え方は MCP の get_pipeline_now（src/lib/aiRead/analytics/pipeline.ts）と同じ SQL 部品を使う。
//   段階の判定は src/lib/aiRead/caKpi.ts の entryStageCaseSql（get_ca_kpi の currentStatus と同じ）。

import { prisma } from "@/lib/prisma";
import { entryStageCaseSql } from "@/lib/aiRead/caKpi";
import { DECLINED_SQL } from "@/lib/performance/weeklyMatrix";
import { todayJstDateString, jstDateStringToDbDate } from "@/lib/dailyReport/jstDate";

export const SNAPSHOT_CA_KEY_ALL = "ALL";
export const SNAPSHOT_CA_KEY_NONE = "NONE";

export interface PipelineSnapshotRow {
  caKey: string;
  employeeNumber: string | null;
  activeCandidates: number;
  activeStatusActive: number;
  activeStatusWaiting: number;
  entered: number;
  documentScreening: number;
  firstInterview: number;
  secondInterview: number;
  finalInterview: number;
  interviewOther: number;
  offered: number;
  inSelectionRecords: number;
  inSelectionCandidates: number;
  acceptedNotJoined: number;
  upcomingInterviewsFirst: number;
  upcomingInterviewsExisting: number;
}

type Raw = Record<string, unknown> & { grp: string };
const n = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));

/** GROUPING SETS のキー列（ALL / NONE / Employee.id）。 */
const GRP = `CASE WHEN GROUPING(c.employee_id) = 1 THEN '${SNAPSHOT_CA_KEY_ALL}' ELSE COALESCE(c.employee_id, '${SNAPSHOT_CA_KEY_NONE}') END AS grp`;

/**
 * 今の進行中案件を CA 別（＋ALL・NONE）に数える。読み取りのみ。
 * 面談の「初回/2回目以降」は、その求職者に過去の実施済み面談（辞退系・日程再調整以外）が無いかどうかで分ける。
 */
export async function computePipelineSnapshotRows(): Promise<PipelineSnapshotRow[]> {
  const [active, stages, upcoming, cas] = await Promise.all([
    prisma.$queryRawUnsafe<Raw[]>(`
      SELECT ${GRP},
        COUNT(*) FILTER (WHERE c.support_status = 'ACTIVE')::int AS active_cnt,
        COUNT(*) FILTER (WHERE c.support_status = 'WAITING')::int AS waiting_cnt
      FROM candidates c
      WHERE c.support_status IN ('ACTIVE','WAITING')
      GROUP BY GROUPING SETS ((c.employee_id), ());`),
    prisma.$queryRawUnsafe<Raw[]>(`
      SELECT ${GRP},
        COUNT(*) FILTER (WHERE x.stage = 'entered')::int AS entered,
        COUNT(*) FILTER (WHERE x.stage = 'documentScreening')::int AS document_screening,
        COUNT(*) FILTER (WHERE x.stage = 'firstInterview')::int AS first_interview,
        COUNT(*) FILTER (WHERE x.stage = 'secondInterview')::int AS second_interview,
        COUNT(*) FILTER (WHERE x.stage = 'finalInterview')::int AS final_interview,
        COUNT(*) FILTER (WHERE x.stage = 'interviewOther')::int AS interview_other,
        COUNT(*) FILTER (WHERE x.stage = 'offered')::int AS offered,
        COUNT(*) FILTER (WHERE x.stage IN ('documentScreening','firstInterview','secondInterview','finalInterview','interviewOther','offered'))::int AS in_sel_recs,
        COUNT(DISTINCT x.candidate_id) FILTER (WHERE x.stage IN ('documentScreening','firstInterview','secondInterview','finalInterview','interviewOther','offered'))::int AS in_sel_cands,
        COUNT(*) FILTER (WHERE x.stage = 'acceptedNotJoined')::int AS accepted_not_joined
      FROM (
        SELECT je.candidate_id, ${entryStageCaseSql()} AS stage
        FROM job_entries je
        WHERE je.archived_at IS NULL AND je.is_active = TRUE
      ) x
      JOIN candidates c ON c.id = x.candidate_id
      WHERE x.stage IS NOT NULL
      GROUP BY GROUPING SETS ((c.employee_id), ());`),
    prisma.$queryRawUnsafe<Raw[]>(`
      SELECT ${GRP},
        COUNT(*) FILTER (WHERE NOT x.has_past)::int AS up_first,
        COUNT(*) FILTER (WHERE x.has_past)::int AS up_existing
      FROM (
        SELECT ir.candidate_id,
          EXISTS (
            SELECT 1 FROM interview_records p
            WHERE p.candidate_id = ir.candidate_id AND p.interview_date <= (now() AT TIME ZONE 'UTC')
              AND (p.result_flag IS NULL OR p.result_flag NOT IN (${DECLINED_SQL}, '日程再調整'))
          ) AS has_past
        FROM interview_records ir
        WHERE ir.interview_date > (now() AT TIME ZONE 'UTC')
          AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}, '日程再調整'))
      ) x
      JOIN candidates c ON c.id = x.candidate_id
      GROUP BY GROUPING SETS ((c.employee_id), ());`),
    prisma.employee.findMany({ where: { jobCategory: "CA" }, select: { id: true, employeeNumber: true } }),
  ]);

  const rows = new Map<string, PipelineSnapshotRow>();
  const get = (key: string): PipelineSnapshotRow => {
    let r = rows.get(key);
    if (!r) {
      r = {
        caKey: key,
        employeeNumber: null,
        activeCandidates: 0, activeStatusActive: 0, activeStatusWaiting: 0,
        entered: 0, documentScreening: 0, firstInterview: 0, secondInterview: 0, finalInterview: 0, interviewOther: 0, offered: 0,
        inSelectionRecords: 0, inSelectionCandidates: 0, acceptedNotJoined: 0,
        upcomingInterviewsFirst: 0, upcomingInterviewsExisting: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  // 在籍 CA は値が 0 でも行を作る（「その日は 0 件だった」を残すため）。ALL も必ず作る。
  get(SNAPSHOT_CA_KEY_ALL);
  for (const ca of cas) get(ca.id).employeeNumber = ca.employeeNumber;
  for (const r of active) {
    const x = get(r.grp);
    x.activeStatusActive = n(r.active_cnt);
    x.activeStatusWaiting = n(r.waiting_cnt);
    x.activeCandidates = x.activeStatusActive + x.activeStatusWaiting;
  }
  for (const r of stages) {
    const x = get(r.grp);
    x.entered = n(r.entered);
    x.documentScreening = n(r.document_screening);
    x.firstInterview = n(r.first_interview);
    x.secondInterview = n(r.second_interview);
    x.finalInterview = n(r.final_interview);
    x.interviewOther = n(r.interview_other);
    x.offered = n(r.offered);
    x.inSelectionRecords = n(r.in_sel_recs);
    x.inSelectionCandidates = n(r.in_sel_cands);
    x.acceptedNotJoined = n(r.accepted_not_joined);
  }
  for (const r of upcoming) {
    const x = get(r.grp);
    x.upcomingInterviewsFirst = n(r.up_first);
    x.upcomingInterviewsExisting = n(r.up_existing);
  }
  return [...rows.values()];
}

export interface SavePipelineSnapshotResult {
  snapshotDate: string;
  rows: number;
  created: number;
  updated: number;
}

/**
 * 今日（JST）の分を保存する。既に同じ日の行があれば上書きして run_count を +1（重複行は作らない）。
 * 日付は今日固定（過去の日付を作らない）。
 */
export async function savePipelineSnapshot(params: { execute: boolean }): Promise<SavePipelineSnapshotResult & { preview: PipelineSnapshotRow[] }> {
  const ymd = todayJstDateString();
  const snapshotDate = jstDateStringToDbDate(ymd);
  const rows = await computePipelineSnapshotRows();
  if (!params.execute) return { snapshotDate: ymd, rows: rows.length, created: 0, updated: 0, preview: rows };

  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const { caKey, ...data } = r;
      const existing = await tx.caPipelineDailySnapshot.findUnique({
        where: { snapshotDate_caKey: { snapshotDate, caKey } },
        select: { id: true, runCount: true },
      });
      if (existing) {
        await tx.caPipelineDailySnapshot.update({
          where: { id: existing.id },
          data: { ...data, runCount: existing.runCount + 1, generatedAt: new Date() },
        });
        updated++;
      } else {
        await tx.caPipelineDailySnapshot.create({ data: { snapshotDate, caKey, ...data } });
        created++;
      }
    }
  });
  return { snapshotDate: ymd, rows: rows.length, created, updated, preview: rows };
}

// T-XXX step5C: get_pipeline_now — 今の進行中案件を段階別 × CA別に、今後の面談予約数（初回/継続）、承諾済み未入社。
import { prisma } from "@/lib/prisma";
import { entryStageCaseSql } from "@/lib/aiRead/caKpi";
import { computePipelineSnapshotRows, SNAPSHOT_CA_KEY_ALL, SNAPSHOT_CA_KEY_NONE } from "@/lib/pipeline-snapshot";
import { buildEnvelope, resolveCas, daysBetween, distribution, jstMonthOf, checkResponseSize, COMMON_DEFINITIONS, NOW_UTC, ALL_KEY } from "./common";

interface StageRow {
  candidate_id: string;
  employee_id: string | null;
  stage: string;
  entry_at: Date;
  last_stage_at: Date | null;
  acceptance_at: Date | null;
  join_at: Date | null;
}

export const PIPELINE_STAGES = ["entered", "documentScreening", "firstInterview", "secondInterview", "finalInterview", "interviewOther", "offered"] as const;

export async function buildPipelineNow(input: { caId?: string }): Promise<Record<string, unknown>> {
  const { roster, targets, single } = await resolveCas(input.caId);
  const [snapRows, stageRows] = await Promise.all([
    computePipelineSnapshotRows(),
    prisma.$queryRawUnsafe<StageRow[]>(`
      SELECT x.candidate_id, c.employee_id, x.stage, x.entry_at, x.last_stage_at, x.acceptance_at, x.join_at
      FROM (
        SELECT je.candidate_id, ${entryStageCaseSql()} AS stage, je.entry_date AS entry_at,
          GREATEST(je.document_submit_date, je.document_pass_date, je.first_interview_date, je.second_interview_date, je.final_interview_date, je.offer_date) AS last_stage_at,
          je.acceptance_date AS acceptance_at, je.join_date AS join_at
        FROM job_entries je
        WHERE je.archived_at IS NULL AND je.is_active = TRUE
      ) x JOIN candidates c ON c.id = x.candidate_id
      WHERE x.stage IN ('entered','documentScreening','firstInterview','secondInterview','finalInterview','interviewOther','offered','acceptedNotJoined');`),
  ]);
  const now = new Date();
  const summarizeStages = (rs: StageRow[]) => {
    const out: Record<string, unknown> = {};
    for (const s of PIPELINE_STAGES) {
      const hit = rs.filter((r) => r.stage === s);
      out[s] = {
        records: hit.length,
        people: new Set(hit.map((r) => r.candidate_id)).size,
        daysSinceEntry: distribution(hit.map((r) => daysBetween(r.entry_at, now) ?? NaN)),
        daysSinceLastStageDate: distribution(hit.filter((r) => r.last_stage_at).map((r) => daysBetween(r.last_stage_at, now) ?? NaN)),
      };
    }
    const acc = rs.filter((r) => r.stage === "acceptedNotJoined");
    const byJoinMonth: Record<string, number> = {};
    for (const r of acc) {
      const k = r.join_at ? jstMonthOf(r.join_at)! : "unknown";
      byJoinMonth[k] = (byJoinMonth[k] ?? 0) + 1;
    }
    return {
      stages: out,
      inSelection: {
        records: rs.filter((r) => r.stage !== "entered" && r.stage !== "acceptedNotJoined").length,
        people: new Set(rs.filter((r) => r.stage !== "entered" && r.stage !== "acceptedNotJoined").map((r) => r.candidate_id)).size,
      },
      acceptedNotJoined: {
        records: acc.length,
        byJoinMonth,
        daysSinceAcceptance: distribution(acc.filter((r) => r.acceptance_at).map((r) => daysBetween(r.acceptance_at, now) ?? NaN)),
      },
    };
  };
  const snapByKey = new Map(snapRows.map((r) => [r.caKey, r]));
  const caBlock = (key: string, label: string, rs: StageRow[]) => {
    const s = snapByKey.get(key);
    return {
      ca: label,
      activeCandidates: s ? { total: s.activeCandidates, active: s.activeStatusActive, waiting: s.activeStatusWaiting } : { total: 0, active: 0, waiting: 0 },
      upcomingInterviews: s ? { first: s.upcomingInterviewsFirst, existing: s.upcomingInterviewsExisting, total: s.upcomingInterviewsFirst + s.upcomingInterviewsExisting } : { first: 0, existing: 0, total: 0 },
      ...summarizeStages(rs),
    };
  };
  const rows: Record<string, unknown>[] = [];
  if (!single) rows.push(caBlock(SNAPSHOT_CA_KEY_ALL, ALL_KEY, stageRows));
  for (const ca of targets) rows.push(caBlock(ca.id, ca.employeeNumber, stageRows.filter((r) => r.employee_id === ca.id)));
  if (!single) rows.push(caBlock(SNAPSHOT_CA_KEY_NONE, "NONE", stageRows.filter((r) => r.employee_id == null)));

  const env = await buildEnvelope({
    tool: "get_pipeline_now",
    period: null,
    cas: targets,
    single,
    roster,
    exclusions: ["アーカイブ済み・無効（is_active=false）のエントリー", "段階が 辞退/見送り/クローズ/入社済 の行"],
    counts: { records: stageRows.length, people: new Set(stageRows.map((r) => r.candidate_id)).size },
    warnings: ["未来の面談予約は 10 日先程度までしか入っていないことが多い（予約の入力タイミングによる）"],
    definitions: {
      stages: "取得時点の段階（get_ca_kpi の currentStatus と同じ判定）: entered=エントリー済み（書類提出前）、documentScreening=書類選考中、firstInterview/secondInterview/finalInterview=一次/二次/最終面接の段階、interviewOther=面接段階で詳細未分類、offered=内定（承諾前）",
      inSelection: "書類選考〜内定（承諾前）の件数・人数（entered を含まない）",
      acceptedNotJoined: "entry_flag='内定' かつ承諾日あり（入社済にまだなっていない）。byJoinMonth は入社予定月（join_date の JST 月・無ければ unknown）",
      daysSinceEntry: "エントリー日から今日までの暦日数の分布（段階ごと）",
      daysSinceLastStageDate: "最後に入った段階の日付（書類提出・書類通過・各面接・内定の最大）から今日までの暦日数の分布",
      activeCandidates: "support_status が ACTIVE / WAITING の人数",
      upcomingInterviews: `面談日が今より後で辞退系・日程再調整でない面談予約。first=その求職者に過去の実施済み面談が無い（初回）、existing=2 回目以降。NOW は ${NOW_UTC} で判定`,
      NONE: "担当CAが未設定の求職者の分（ALL には含まれる）",
      attribution: COMMON_DEFINITIONS.attribution,
      suppression: "件数・人数は伏せない（運用上の現在値）。分布だけ標本 5 未満で伏せる",
    },
  });
  const body = { ...env, rows };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}

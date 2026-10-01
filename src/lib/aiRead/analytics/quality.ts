// T-XXX step5C: get_data_quality — 項目ごとの入力率・記録開始日・定義の注意点・品質警告の一覧。
import { prisma } from "@/lib/prisma";
import { CA_KPI_CAVEATS } from "@/lib/aiRead/caKpiResponse";
import { buildEnvelope, loadRoster, resolveMonthRange, firstInterviewCteSql, jstMonthExpr, sqlStr, ratio, isDefaultCa, COMMON_DEFINITIONS, RELIABLE_FROM_MONTH } from "./common";

const DETAIL_FIELDS: { key: string; col: string; label: string }[] = [
  { key: "desiredJobType1", col: "desired_job_type_1", label: "希望職種1" },
  { key: "desiredJobTypes", col: "desired_job_types", label: "希望職種（複数）" },
  { key: "desiredIndustry1", col: "desired_industry_1", label: "希望業界1" },
  { key: "desiredPrefecture", col: "desired_prefecture", label: "希望勤務地（都道府県）" },
  { key: "desiredTransfer", col: "desired_transfer", label: "転居・転勤" },
  { key: "currentSalary", col: "current_salary", label: "現年収（万円）" },
  { key: "desiredSalaryMin", col: "desired_salary_min", label: "希望年収下限（万円）" },
  { key: "desiredEmploymentType", col: "desired_employment_type", label: "希望雇用形態" },
  { key: "desiredDayOff", col: "desired_day_off", label: "希望休日" },
  { key: "desiredOvertimeMax", col: "desired_overtime_max", label: "残業上限" },
  { key: "jobChangeTimeline", col: "job_change_timeline", label: "転職時期" },
  { key: "activityPeriod", col: "activity_period", label: "活動期間" },
  { key: "currentApplicationCount", col: "current_application_count", label: "他社応募数" },
  { key: "agentUsageFlag", col: "agent_usage_flag", label: "他社エージェント利用" },
  { key: "employmentStatus", col: "employment_status", label: "在職状況" },
  { key: "educationFlag", col: "education_flag", label: "最終学歴" },
  { key: "graduationStatus", col: "graduation_status", label: "卒業区分" },
  { key: "jobTypeFlag", col: "job_type_flag", label: "経験職種" },
  { key: "resignReasonLarge", col: "resign_reason_large", label: "転職理由（大区分）" },
  { key: "priorityCondition1", col: "priority_condition_1", label: "優先条件1" },
  { key: "documentStatusFlag", col: "document_status_flag", label: "書類の状態" },
  { key: "nextInterviewDate", col: "next_interview_date", label: "次回面談日" },
];

const ENTRY_FIELDS: { key: string; col: string; label: string }[] = [
  { key: "documentSubmitDate", col: "document_submit_date", label: "書類提出日" },
  { key: "documentPassDate", col: "document_pass_date", label: "書類通過日" },
  { key: "firstInterviewDate", col: "first_interview_date", label: "一次面接日" },
  { key: "secondInterviewDate", col: "second_interview_date", label: "二次面接日" },
  { key: "finalInterviewDate", col: "final_interview_date", label: "最終面接日" },
  { key: "offerDate", col: "offer_date", label: "内定日" },
  { key: "acceptanceDate", col: "acceptance_date", label: "承諾日" },
  { key: "joinDate", col: "join_date", label: "入社日" },
  { key: "externalJobNo", col: "external_job_no", label: "求人番号" },
  { key: "jobCategory", col: "job_category", label: "求人の職種" },
];

export async function buildDataQuality(input: { from?: string; to?: string }): Promise<Record<string, unknown>> {
  const { from, to, months } = resolveMonthRange(input.from, input.to, { from: RELIABLE_FROM_MONTH });
  const roster = await loadRoster();
  const detailSql = DETAIL_FIELDS.map((f) => `COUNT(d.${f.col})::int AS "${f.key}"`).join(",\n        ");
  const entrySql = ENTRY_FIELDS.map((f) => `COUNT(je.${f.col})::int AS "${f.key}"`).join(",\n        ");
  const [detail, entry, accept, interview] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, number>[]>(`
      WITH ${firstInterviewCteSql()}
      SELECT COUNT(*)::int AS first_interviews, COUNT(d.id)::int AS with_detail,
        ${detailSql}
      FROM first_iv f LEFT JOIN interview_details d ON d.interview_record_id = f.interview_id
      WHERE ${jstMonthExpr("f.first_at")} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)};`),
    prisma.$queryRawUnsafe<Record<string, number>[]>(`
      SELECT COUNT(*)::int AS entries,
        ${entrySql}
      FROM job_entries je
      WHERE je.archived_at IS NULL AND je.entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')
        AND ${jstMonthExpr("je.entry_date")} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)};`),
    prisma.$queryRawUnsafe<Record<string, number>[]>(`
      SELECT COUNT(*)::int AS deals, COUNT(je.revenue)::int AS revenue, COUNT(je.job_db_cost)::int AS job_db_cost, COUNT(je.cost)::int AS cost,
        COUNT(je.fee_type)::int AS fee_type, COUNT(je.join_date)::int AS join_date
      FROM job_entries je
      WHERE je.archived_at IS NULL AND je.acceptance_date IS NOT NULL
        AND ${jstMonthExpr("je.acceptance_date")} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)};`),
    prisma.$queryRawUnsafe<Record<string, number>[]>(`
      SELECT COUNT(*)::int AS records,
        COUNT(*) FILTER (WHERE ir.result_flag IS NULL OR ir.result_flag = '')::int AS result_flag_empty,
        COUNT(*) FILTER (WHERE ir.interview_count IS NULL)::int AS count_null,
        COUNT(rt.id)::int AS with_rating
      FROM interview_records ir LEFT JOIN interview_ratings rt ON rt.interview_record_id = ir.id
      WHERE ${jstMonthExpr("ir.interview_date")} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)};`),
  ]);
  const d = detail[0] ?? {};
  const e = entry[0] ?? {};
  const a = accept[0] ?? {};
  const iv = interview[0] ?? {};
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
  const firstInterviews = n(d.first_interviews);
  const entries = n(e.entries);
  const deals = n(a.deals);
  const env = await buildEnvelope({
    tool: "get_data_quality",
    period: { from, to, months: months.length },
    cas: roster.filter((c) => isDefaultCa(c)),
    single: false,
    roster,
    exclusions: [],
    counts: { firstInterviews, entries, deals, interviewRecords: n(iv.records) },
    warnings: [
      "ALL の人数・件数は担当なし・CA 以外の担当の求職者を含む（既存ツールと同じ）",
      "面談の『実施者』欄は予約を入れた人であって担当CAではない（CA別の集計は担当軸）",
      "選考ステータス・支援状況・希望条件の変更履歴と日次スナップショットは historySince の日付から始まり、それより前の履歴は無い（推定で埋めていない）",
    ],
    definitions: {
      inputRate: "初回面談の面談詳細（interview_details）の各項目が空でない割合（分母＝期間の初回面談人数）。エントリーは各日付列が入っている割合（分母＝期間のエントリー件数・到達していない案件も分母に入るので 100% にはならない）",
      historySince: "各記録の最初の行の日時（JST）。null はまだ 1 件も無い",
      firstInterview: COMMON_DEFINITIONS.firstInterview,
      tenure: COMMON_DEFINITIONS.tenure,
      attribution: COMMON_DEFINITIONS.attribution,
      suppression: COMMON_DEFINITIONS.suppression,
      reference: COMMON_DEFINITIONS.reference,
    },
  });
  return {
    ...env,
    interviewDetailInputRates: {
      denominator: firstInterviews,
      withDetail: n(d.with_detail),
      withDetailRate: ratio(n(d.with_detail), firstInterviews),
      fields: DETAIL_FIELDS.map((f) => ({ field: f.key, label: f.label, filled: n(d[f.key]), rate: ratio(n(d[f.key]), firstInterviews) })),
    },
    entryInputRates: {
      denominator: entries,
      fields: ENTRY_FIELDS.map((f) => ({ field: f.key, label: f.label, filled: n(e[f.key]), rate: ratio(n(e[f.key]), entries) })),
    },
    acceptanceInputRates: {
      denominator: deals,
      fields: [
        { field: "revenue", label: "承諾売上（税抜）", filled: n(a.revenue), rate: ratio(n(a.revenue), deals) },
        { field: "jobDbCost", label: "求人DB費", filled: n(a.job_db_cost), rate: ratio(n(a.job_db_cost), deals) },
        { field: "cost", label: "仕入", filled: n(a.cost), rate: ratio(n(a.cost), deals) },
        { field: "feeType", label: "課金方式", filled: n(a.fee_type), rate: ratio(n(a.fee_type), deals) },
        { field: "joinDate", label: "入社日", filled: n(a.join_date), rate: ratio(n(a.join_date), deals) },
      ],
    },
    interviewRecordQuality: {
      records: n(iv.records),
      resultFlagEmpty: n(iv.result_flag_empty),
      interviewCountNull: n(iv.count_null),
      withRating: n(iv.with_rating),
      ratingRate: ratio(n(iv.with_rating), n(iv.records)),
    },
    roster: roster.map((c) => ({
      employeeNumber: c.employeeNumber,
      name: c.name,
      status: c.status,
      hireDateRegistered: !!c.hireDate,
      resignDateRegistered: !!c.resignDate,
      inDefaultAggregation: isDefaultCa(c),
    })),
    knownCaveats: [
      ...CA_KPI_CAVEATS,
      "面談記録の面談日は予定日＝実施日（1 つしか無い）。辞退→日付変更→再利用の履歴は残らない（2026-10 以降は面談結果の変更も記録していない）",
      "承諾後辞退の行も承諾日・売上が残っている（get_accept_revenue で分けて返す。既存 get_company_kpi には含まれる）",
      "join_date は入社予定日と実入社日の区別が無い。gross_profit 列は 2026-07 以降書かれていない（粗利は revenue − job_db_cost − cost で計算）",
      "年収の単位は万円。0 は未記載の可能性がある",
      "『転職活動』の単位は無く 1 人 1 レコード。再応募は reapplication_count で分かるが過去の再活動は区別できない",
    ],
  };
}

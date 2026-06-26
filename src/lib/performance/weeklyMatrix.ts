// T-071 FileMaker 形 週マトリクスの集計。computeCaMetricsForRange は変更せず、
// 新規/既存の区別・件数/人数/1人当たり・選考状況（決定売上等）を raw SQL で算出する。
//
// 数え方（T-071 確定を踏襲）：
//   - 担当軸＝candidate.employeeId（面談・エントリー・選考状況・**求人紹介も統一**）。
//   - 求人紹介（提案）は **JobEntry.jobIntroDate ∪ CandidateFile BOOKMARK.lastExportedAt** の両ソース統合
//     （記録方式が 2026/4 に移行。片方だけでは過去 or 現在が欠ける）。candidate×同日のクロスソース重複は除外。
//   - 無効（isActive=false）含む・アーカイブ（archivedAt）除く。
//   - 件数＝レコード件数、人数＝候補者ユニーク、1人当たり＝件数÷人数。
//   - 新規/既存：その候補者の**通算最古日（MIN）がレンジ内なら新規・レンジ前なら既存**（提案・エントリーとも候補者単位で排他。初回+既存=合計）。
//   - 面談は notDeclined（辞退系以外、null 含む）でカウント。
//   - JST 境界は呼び出し側が from/to(Date) で渡す（罠 #17）。列は UTC 保存なので UTC wall-clock で比較。

import { prisma } from "@/lib/prisma";
import { INTERVIEW_DECLINED_FLAGS } from "@/lib/dailyReport/constants";

export interface CountUniqPer {
  recs: number; // 件数
  uniq: number; // 人数（候補者ユニーク）
  perPerson: number | null; // 1人当たり = 件数 ÷ 人数
}

// 期間内 初回/2回目以降 定義（rankWindow 全体での ROW_NUMBER 基準）。
// 各区分は recs=件数（加算可能・Σ週=合計）と uniq=人数（ユニーク候補者数・非加算）の2軸。
// fresh=期間内初回 / existing=期間内2回目以降 / total=期間内総数（fresh+existing）/ pureFresh=BizStudio全期間で初回（純粋新規・候補者単位）。
export interface ScopedSeg {
  recs: number; // 件数（社数）
  uniq: number; // 人数（ユニーク候補者数）
}
export interface ScopedNewExisting {
  fresh: ScopedSeg;
  existing: ScopedSeg;
  total: ScopedSeg;
  pureFresh: number;
}

export interface WeeklyMatrix {
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: CountUniqPer; existing: CountUniqPer; total: CountUniqPer; scoped: ScopedNewExisting };
  entry: { fresh: CountUniqPer; existing: CountUniqPer; total: CountUniqPer; scoped: ScopedNewExisting };
  selection: {
    documentPass: number; // 人数（COUNT DISTINCT）
    offer: number;
    acceptance: number;
    documentPassRecs: number; // 件数（社数・COUNT(*)）。週セルの加算可能な値。
    offerRecs: number;
    acceptanceRecs: number;
    decidedRevenue: number | null;
    decidedUnitPrice: number | null;
  };
}

// 合計列を「各列(週/月)の合算」にする（提案/エントリーの新規/既存/合計＝件数・人数、選考の人数・件数）。
// 期間の実ユニーク(DISTINCT)ではなく Σ列にすることで、縦(新規+既存=合計)・横(Σ週=合計)が件数も人数も一致する。
// 売上・1人当たり(CUP)・面談は対象外（total の値をそのまま使う）。total を破壊的に上書きする。
export function applyAdditiveTotals(total: WeeklyMatrix, columns: WeeklyMatrix[]): void {
  const sum = (sel: (m: WeeklyMatrix) => number) => columns.reduce((s, m) => s + sel(m), 0);
  const seg = (pick: (m: WeeklyMatrix) => ScopedSeg): ScopedSeg => ({
    recs: sum((m) => pick(m).recs),
    uniq: sum((m) => pick(m).uniq),
  });
  for (const k of ["proposal", "entry"] as const) {
    total[k].scoped = {
      fresh: seg((m) => m[k].scoped.fresh),
      existing: seg((m) => m[k].scoped.existing),
      total: seg((m) => m[k].scoped.total),
      pureFresh: sum((m) => m[k].scoped.pureFresh),
    };
  }
  total.selection.documentPass = sum((m) => m.selection.documentPass);
  total.selection.offer = sum((m) => m.selection.offer);
  total.selection.acceptance = sum((m) => m.selection.acceptance);
  total.selection.documentPassRecs = sum((m) => m.selection.documentPassRecs);
  total.selection.offerRecs = sum((m) => m.selection.offerRecs);
  total.selection.acceptanceRecs = sum((m) => m.selection.acceptanceRecs);
}

// timestamp(無tz, UTC 保存) 列と比較するための UTC wall-clock リテラル。
function tsLit(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
function per(recs: number, uniq: number): number | null {
  return uniq > 0 ? recs / uniq : null;
}
const DECLINED_SQL = INTERVIEW_DECLINED_FLAGS.map((f) => `'${f}'`).join(",");

export async function computeWeeklyMatrix(params: {
  employeeId: string;
  userId: string;
  from: Date;
  to: Date;
  allCas?: boolean; // true なら全CA合算（担当・User フィルタを外す。数え方は同じ）
  // 新規/既存（scoped）の「期間内 初回/2回目以降」ランクを計算する全体窓。
  // 週セル集計では各週を [from,to]、ランク窓を表示期間全体（全列カバー範囲）にすることで Σ週=合計 が成立する。
  // 省略時は [from,to]（＝その範囲内ランク）。
  rankWindow?: { from: Date; to: Date };
}): Promise<WeeklyMatrix> {
  const { employeeId, userId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  const rw = params.rankWindow ?? { from, to };
  const RF = tsLit(rw.from);
  const RT = tsLit(rw.to);
  // 全員モードでは担当軸フィルタを外す（対象を全候補者に広げるだけ）。
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  void userId; // 求人紹介も candidate.employeeId 軸に統一したため User.id は未使用（signature は後方互換で維持）。

  // 提案イベント（両ソース統合・dedup）の共通 CTE 文。scoped 計算で再利用。
  // 件数の重複排除：同一求職者・同一日(JST)・同一求人を 1 件に寄せる（GROUP BY、pdate は当日最古）。
  //   JE 側＝external_job_id、CF(BOOKMARK) 側＝file_name を「求人」キーに使う。
  const PROPOSAL_EVENTS = `
      SELECT je.candidate_id, MIN(je.job_intro_date) AS pdate
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL AND je.job_intro_date IS NOT NULL
      GROUP BY je.candidate_id, je.external_job_id, (je.job_intro_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
      UNION ALL
      SELECT cf.candidate_id, MIN(cf.last_exported_at) AS pdate
      FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id
      WHERE ${empPred} AND cf.category = 'BOOKMARK' AND cf.last_exported_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_entries je2
          WHERE je2.candidate_id = cf.candidate_id AND je2.archived_at IS NULL AND je2.job_intro_date IS NOT NULL
            AND (je2.job_intro_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
              = (cf.last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
        )
      GROUP BY cf.candidate_id, cf.file_name, (cf.last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date`;
  const ENTRY_EVENTS = `
      SELECT je.candidate_id, MIN(je.entry_date) AS pdate
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL
        AND je.entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')
      GROUP BY je.candidate_id, je.external_job_id, (je.entry_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date`;
  // 期間内 初回/2回目以降（scoped）: 「週ごと・求職者単位」で振り分け、件数も人数も縦横で加算一致させる。
  //   first_win = rankWindow 内での候補者の初回イベント日時。cell 内イベントは
  //     first_win が cell 内（first_win>=F）→ 新規（その求職者の初回週）、first_win<F → 既存（2回目以降の週）。
  //   候補者ごとにクラスが一意なので per-cell で 新規+既存=合計（件数・人数とも）。1週目は全員初登場で既存=0。
  //   合計列は各週の合算（DISTINCT 再集計しない）＝route 側で Σ列。
  //   pureFresh=純粋新規（BizStudio 全期間で初回・候補者単位）: cell が初回週(first_win∈cell) かつ 全期間初回も window 内(first_all>=RF)。
  const scopedSql = (eventsSql: string) => `
    WITH events AS (${eventsSql}),
    fa AS (SELECT candidate_id, MIN(pdate) AS first_all FROM events GROUP BY candidate_id),
    win AS (
      SELECT e.candidate_id, e.pdate, fa.first_all,
        MIN(e.pdate) OVER (PARTITION BY e.candidate_id) AS first_win
      FROM events e JOIN fa ON fa.candidate_id = e.candidate_id
      WHERE e.pdate BETWEEN TIMESTAMP '${RF}' AND TIMESTAMP '${RT}'
    )
    SELECT
      COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_win >= TIMESTAMP '${F}')::int sc_new,
      COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_win <  TIMESTAMP '${F}')::int sc_ex,
      COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int sc_tot,
      COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_win >= TIMESTAMP '${F}')::int sc_new_u,
      COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_win <  TIMESTAMP '${F}')::int sc_ex_u,
      COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int sc_tot_u,
      COUNT(DISTINCT candidate_id) FILTER (WHERE first_win BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_all >= TIMESTAMP '${RF}')::int sc_pure
    FROM win;`;

  const [iv, prop, ent, sel, propScoped, entScoped] = await Promise.all([
    // 面談（candidate.employeeId 軸・notDeclined）。second は予約語のため別名にする。
    prisma.$queryRawUnsafe<{ iv_first: number; iv_second: number; iv_third: number; iv_total: number }[]>(`
      SELECT
        COUNT(*) FILTER (WHERE ir.interview_count = 1)::int iv_first,
        COUNT(*) FILTER (WHERE ir.interview_count = 2)::int iv_second,
        COUNT(*) FILTER (WHERE ir.interview_count >= 3)::int iv_third,
        COUNT(*) FILTER (WHERE ir.interview_count >= 1)::int iv_total
      FROM interview_records ir JOIN candidates c ON c.id = ir.candidate_id
      WHERE ${empPred}
        AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
        AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}';`),

    // 求人紹介（提案）＝両ソース統合：JobEntry.jobIntroDate（旧・〜2026/4）∪ CandidateFile BOOKMARK.lastExportedAt（新・2026/4〜）。
    // 担当はどちらも candidate.employeeId 軸に統一。無効含む・archivedAt 除く（JobEntry）。
    // 移行期の二重記録ガード：同一候補者×同一日に JE 提案があれば CF 側は同一提案とみなし除外（NOT EXISTS）。
    //   ※実データ検証で同日クロスソース衝突は 0 件のため現状は no-op だが、移行重複の保険。
    // 初回/既存は統合イベントの候補者**通算最古日（MIN(pdate)）が基準**＝entry と同型（候補者単位で排他）。
    //   first_p >= F：その候補者の初回提案がレンジ内＝新規候補者／first_p < F：レンジ前に初回、レンジ内で再提案＝既存候補者。
    //   ⚠️ ROW_NUMBER（rn=1/rn>1・イベント単位）方式は、1人月20件の提案があると新規候補者も同月に2件目以降を持ち
    //      「初回にも既存にも二重計上」され、既存≒合計になる誤り（T-071 修正①で MIN 方式へ）。
    prisma.$queryRawUnsafe<{ new_recs: number; new_uniq: number; ex_recs: number; ex_uniq: number; tot_recs: number; tot_uniq: number }[]>(`
      WITH events AS (
        SELECT je.candidate_id, je.job_intro_date AS pdate
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE ${empPred} AND je.archived_at IS NULL AND je.job_intro_date IS NOT NULL
        UNION ALL
        SELECT cf.candidate_id, cf.last_exported_at AS pdate
        FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id
        WHERE ${empPred} AND cf.category = 'BOOKMARK' AND cf.last_exported_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM job_entries je2
            WHERE je2.candidate_id = cf.candidate_id AND je2.archived_at IS NULL AND je2.job_intro_date IS NOT NULL
              AND (je2.job_intro_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
                = (cf.last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
          )
      ),
      props AS (
        SELECT candidate_id, pdate, MIN(pdate) OVER (PARTITION BY candidate_id) AS first_p
        FROM events
      )
      SELECT
        COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p >= TIMESTAMP '${F}')::int new_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p >= TIMESTAMP '${F}')::int new_uniq,
        COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p < TIMESTAMP '${F}')::int ex_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p < TIMESTAMP '${F}')::int ex_uniq,
        COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_uniq
      FROM props;`),

    // エントリー（JobEntry・candidate.employeeId 軸・post-app・archived除く）。新規＝その候補者の初回エントリーがレンジ内。
    prisma.$queryRawUnsafe<{ new_recs: number; new_uniq: number; ex_recs: number; ex_uniq: number; tot_recs: number; tot_uniq: number }[]>(`
      WITH ents AS (
        SELECT je.candidate_id, je.entry_date,
          MIN(je.entry_date) OVER (PARTITION BY je.candidate_id) AS first_entry
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE ${empPred} AND je.archived_at IS NULL
          AND je.entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')
      )
      SELECT
        COUNT(*) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry >= TIMESTAMP '${F}')::int new_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry >= TIMESTAMP '${F}')::int new_uniq,
        COUNT(*) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry < TIMESTAMP '${F}')::int ex_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry < TIMESTAMP '${F}')::int ex_uniq,
        COUNT(*) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_uniq
      FROM ents;`),

    // 選考状況（JobEntry・candidate.employeeId 軸・archived除く・候補者ユニーク人数＋決定売上）
    prisma.$queryRawUnsafe<{ dp: number; ofc: number; ac: number; dp_recs: number; ofc_recs: number; ac_recs: number; revenue: string | null; gross: string | null }[]>(`
      SELECT
        COUNT(DISTINCT je.candidate_id) FILTER (WHERE je.document_pass_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int dp,
        COUNT(DISTINCT je.candidate_id) FILTER (WHERE je.offer_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int ofc,
        COUNT(DISTINCT je.candidate_id) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int ac,
        COUNT(*) FILTER (WHERE je.document_pass_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int dp_recs,
        COUNT(*) FILTER (WHERE je.offer_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int ofc_recs,
        COUNT(*) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int ac_recs,
        COALESCE(SUM(je.revenue) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'), 0)::bigint revenue,
        COALESCE(SUM(je.revenue - COALESCE(je.job_db_cost, 0) - COALESCE(je.cost, 0)) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'), 0)::bigint gross
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL;`),

    // 提案 scoped（期間内 初回/2回目以降・純粋新規）
    prisma.$queryRawUnsafe<{ sc_new: number; sc_ex: number; sc_tot: number; sc_new_u: number; sc_ex_u: number; sc_tot_u: number; sc_pure: number }[]>(scopedSql(PROPOSAL_EVENTS)),
    // エントリー scoped
    prisma.$queryRawUnsafe<{ sc_new: number; sc_ex: number; sc_tot: number; sc_new_u: number; sc_ex_u: number; sc_tot_u: number; sc_pure: number }[]>(scopedSql(ENTRY_EVENTS)),
  ]);

  const i = iv[0];
  const pr = prop[0];
  const en = ent[0];
  const s = sel[0];
  const ps = propScoped[0];
  const es = entScoped[0];

  const revenue = s.revenue != null ? Number(s.revenue) : 0;
  // T-100: 決定粗利 = Σ(revenue - (jobDbCost ?? 0) - (cost ?? 0))。決定判定（revenue>0）は控除前の売上で行い件数定義を維持。
  const gross = s.gross != null ? Number(s.gross) : 0;
  const decidedRevenue = revenue > 0 ? gross : null;
  const decidedUnitPrice = decidedRevenue != null && s.ac > 0 ? gross / s.ac : null;

  return {
    interview: { first: i.iv_first, second: i.iv_second, thirdPlus: i.iv_third, total: i.iv_total },
    proposal: {
      fresh: { recs: pr.new_recs, uniq: pr.new_uniq, perPerson: per(pr.new_recs, pr.new_uniq) },
      existing: { recs: pr.ex_recs, uniq: pr.ex_uniq, perPerson: per(pr.ex_recs, pr.ex_uniq) },
      total: { recs: pr.tot_recs, uniq: pr.tot_uniq, perPerson: per(pr.tot_recs, pr.tot_uniq) },
      scoped: {
        fresh: { recs: ps.sc_new, uniq: ps.sc_new_u },
        existing: { recs: ps.sc_ex, uniq: ps.sc_ex_u },
        total: { recs: ps.sc_tot, uniq: ps.sc_tot_u },
        pureFresh: ps.sc_pure,
      },
    },
    entry: {
      fresh: { recs: en.new_recs, uniq: en.new_uniq, perPerson: per(en.new_recs, en.new_uniq) },
      existing: { recs: en.ex_recs, uniq: en.ex_uniq, perPerson: per(en.ex_recs, en.ex_uniq) },
      total: { recs: en.tot_recs, uniq: en.tot_uniq, perPerson: per(en.tot_recs, en.tot_uniq) },
      scoped: {
        fresh: { recs: es.sc_new, uniq: es.sc_new_u },
        existing: { recs: es.sc_ex, uniq: es.sc_ex_u },
        total: { recs: es.sc_tot, uniq: es.sc_tot_u },
        pureFresh: es.sc_pure,
      },
    },
    selection: {
      documentPass: s.dp,
      offer: s.ofc,
      acceptance: s.ac,
      documentPassRecs: s.dp_recs,
      offerRecs: s.ofc_recs,
      acceptanceRecs: s.ac_recs,
      decidedRevenue,
      decidedUnitPrice,
    },
  };
}

// T-094: 当日「各段階数」棒グラフのツールチップ用。求職者名×件数の内訳を4段階分まとめて返す。
// computeWeeklyMatrix の集計条件（担当軸・interview の辞退除外・JE archived 除外・entry_flag 有効値・両ソース統合）と
// 完全一致させ、バー高さとツールチップの母集団がズレないようにする。集計値自体は computeWeeklyMatrix が引き続き source of truth。
export interface StageDetail { name: string; count: number }
export interface DayStageDetails {
  ivFirst: StageDetail[];   // 初回面談（interview_count=1）
  ivExisting: StageDetail[]; // 既存面談（interview_count>=2、second+thirdPlus 合算）
  proposal: StageDetail[];  // 紹介（JobEntry.jobIntroDate ∪ CandidateFile BOOKMARK.lastExportedAt）
  entry: StageDetail[];     // エントリー（job_entries.entry_flag 有効値）
}

export async function computeDayStageDetails(params: {
  employeeId: string;
  from: Date;
  to: Date;
  allCas?: boolean;
}): Promise<DayStageDetails> {
  const { employeeId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;

  const [ivFirst, ivExisting, proposal, entry] = await Promise.all([
    // 初回面談：interview_count=1（候補者通算初回）。辞退系除外。range は date 列 BETWEEN F..T。
    prisma.$queryRawUnsafe<{ name: string; cnt: number }[]>(`
      SELECT c.name AS name, COUNT(*)::int AS cnt
      FROM interview_records ir JOIN candidates c ON c.id = ir.candidate_id
      WHERE ${empPred}
        AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
        AND ir.interview_count = 1
        AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}'
      GROUP BY c.id, c.name
      ORDER BY cnt DESC, c.name ASC;`),

    // 既存面談：interview_count>=2（2回目以降を合算）。辞退系除外。同条件で GROUP BY。
    prisma.$queryRawUnsafe<{ name: string; cnt: number }[]>(`
      SELECT c.name AS name, COUNT(*)::int AS cnt
      FROM interview_records ir JOIN candidates c ON c.id = ir.candidate_id
      WHERE ${empPred}
        AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
        AND ir.interview_count >= 2
        AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}'
      GROUP BY c.id, c.name
      ORDER BY cnt DESC, c.name ASC;`),

    // 紹介：両ソース統合（JE.jobIntroDate ∪ CF BOOKMARK.lastExportedAt）。
    // NOT EXISTS dedup は同候補者×同日 JST のクロスソース重複を弾く（computeWeeklyMatrix と同条件）。
    // 当日範囲は events CTE 内で pdate 列直接フィルタ（外側で WHERE する代わり）。
    prisma.$queryRawUnsafe<{ name: string; cnt: number }[]>(`
      WITH events AS (
        SELECT je.candidate_id, je.job_intro_date AS pdate
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE ${empPred} AND je.archived_at IS NULL AND je.job_intro_date IS NOT NULL
          AND je.job_intro_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'
        UNION ALL
        SELECT cf.candidate_id, cf.last_exported_at AS pdate
        FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id
        WHERE ${empPred} AND cf.category = 'BOOKMARK' AND cf.last_exported_at IS NOT NULL
          AND cf.last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'
          AND NOT EXISTS (
            SELECT 1 FROM job_entries je2
            WHERE je2.candidate_id = cf.candidate_id AND je2.archived_at IS NULL AND je2.job_intro_date IS NOT NULL
              AND (je2.job_intro_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
                = (cf.last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
          )
      )
      SELECT c2.name AS name, COUNT(*)::int AS cnt
      FROM events e JOIN candidates c2 ON c2.id = e.candidate_id
      GROUP BY c2.id, c2.name
      ORDER BY cnt DESC, c2.name ASC;`),

    // エントリー：job_entries.entry_flag が有効値・archived 除外・entry_date 範囲内。
    prisma.$queryRawUnsafe<{ name: string; cnt: number }[]>(`
      SELECT c.name AS name, COUNT(*)::int AS cnt
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE ${empPred} AND je.archived_at IS NULL
        AND je.entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')
        AND je.entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'
      GROUP BY c.id, c.name
      ORDER BY cnt DESC, c.name ASC;`),
  ]);

  const toList = (rows: { name: string; cnt: number }[]): StageDetail[] =>
    rows.map((r) => ({ name: r.name, count: r.cnt }));

  return {
    ivFirst: toList(ivFirst),
    ivExisting: toList(ivExisting),
    proposal: toList(proposal),
    entry: toList(entry),
  };
}

// 面談ランク割合（円グラフ用）。マトリクスの「**初回面談**」と同条件（担当軸・到達ベース・実施判定・interview_count=1）で
// InterviewRating.overallRank 別に集計。未評価（rating なし or rank null）は '未評価' に寄せる。
// 返り値の合計＝マトリクスの初回面談数（interview.first）と一致する。
// 目的：その期間に新規で会った人の質（ランク）の分布。求人/既存（2回目以降）は再面談で評価が重複するため除外。
export async function computeInterviewRankBreakdown(params: {
  employeeId: string;
  from: Date;
  to: Date;
  allCas?: boolean;
}): Promise<Record<string, number>> {
  const { employeeId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  const rows = await prisma.$queryRawUnsafe<{ rk: string; n: number }[]>(`
    SELECT COALESCE(NULLIF(rt.overall_rank, ''), '未評価') AS rk, COUNT(*)::int n
    FROM interview_records ir
    JOIN candidates c ON c.id = ir.candidate_id
    LEFT JOIN interview_ratings rt ON rt.interview_record_id = ir.id
    WHERE ${empPred}
      AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
      AND ir.interview_count = 1
      AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}'
    GROUP BY COALESCE(NULLIF(rt.overall_rank, ''), '未評価');`);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.rk] = r.n;
  return out;
}

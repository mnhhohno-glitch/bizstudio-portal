// T-XXX step3: /api/ai/ca-kpi の応答組み立て（HTTP 層から独立した関数）。
//
// step2 では route.ts の中にあった処理をそのまま移した。HTTP ルート（Bearer 認証）と MCP ツール（秘密URL）の
// 両方がこの関数を呼び、同じ入力に対して同じ本文を返す。HTTP で自分の API を呼び直すことはしない。
//   - 完全読み取り専用。AI 呼び出しも行わない。
//   - 個人情報は返さない。求職者は件数・人数のみ。CA は社員番号と表示名（INCLUDE_CA_NAME で切替）。
//   - 数え方は実績表の正本 computeWeeklyMatrix に揃える（src/lib/aiRead/caKpi.ts 参照。SQL 部品を共有）。
//   - 担当軸は「今の担当CA」（attribution: current_ca）。
//   - JST 境界は src/lib/dailyReport/jstDate.ts（罠 #17: toISOString().slice(0,10) 禁止）。

import { prisma } from "@/lib/prisma";
import { parseCaKpiQuery, buildCaKpiBuckets, checkCaKpiSizeLimit, CA_KPI_GROUPS, CA_KPI_LIMITS } from "@/lib/aiRead/caKpiParams";
import {
  computeCaKpi,
  metricsFor,
  emptyCurrentStatus,
  queryCaKpiMeta,
  CA_KPI_ALL,
  type CaKpiMetrics,
} from "@/lib/aiRead/caKpi";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";

// 氏名を返すかどうかの切り替え（1か所）。false にすると cas / rows は employeeNumber のみになる（company-kpi と同じ方針）。
const INCLUDE_CA_NAME = true;

/** Date → JST の ISO 文字列（例 2026-10-01T10:15:00+09:00）。toISOString は UTC になるので使わない。 */
export function jstIso(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(" ", "T") + "+09:00";
}
export function jstYmd(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// 数値ごとの定義・基準日付・信頼できる開始日・注意点。ChatGPT がこの文を読んで解釈する前提なので日本語で具体的に書く。
export const CA_KPI_DEFINITIONS = {
  _common: {
    definition: "すべて件数（records）または人数（candidates＝求職者ユニーク）。担当軸は求職者の『今の』担当CA（candidates.employee_id）",
    dateBasis: "各数値の基準日付（下記）が区切り（bucket）の JST 0:00〜23:59:59.999 に入る行を数える",
    reliableFrom: "2026-05-01（2026-04 以前は FileMaker から移行したデータが混ざるため参考値）",
    caution: "担当CAは現在の担当で数えている。担当替えの記録（caAssignmentHistorySince）より前の担当替えは分からず、担当が替わると前の担当の時期の実績も新しい担当に付く。実績表（ホーム画面）と同じ数え方",
  },
  interview: {
    definition: "CAと求職者の面談（interview_records）。total=実施（辞退系 result_flag を除く・interview_count>=1）、first=初回（interview_count=1）、existing=2回目以降、interviewPrep=面接対策（interview_type）、booked=予約数（辞退を含む全記録）、noShow=連絡なし辞退、cancelled=連絡あり辞退・辞退、rescheduled=日程再調整",
    dateBasis: "interview_date（面談日）",
    reliableFrom: "2026-05-01",
    caution: "初回/既存は interview_count（保存時点の通算回数）で判定。初回を辞退して取り直した場合は2回目として数えられる（5月以降の真の初回415件中7件）。企業との面接（selection.firstInterview 等）とは別物",
  },
  "interview.minutes": {
    definition: "minutesTotal=面談時間の合計（分）、minutesKnown=時間が計算できた面談数、minutesAvg=minutesTotal÷minutesKnown（小数1桁）",
    dateBasis: "interview_date",
    reliableFrom: "2026-05-01",
    caution: "開始・終了時刻の差＝**予約枠の長さ（30分・60分）**であり、実際の面談の長さではない。時刻が無い・不正な面談は minutesKnown に入らない",
  },
  interviewRank: {
    definition: "初回面談（interview.first と同じ母集団）の面談評価ランク overall_rank の分布（S/A+/A/B+/B/C/D/unrated）",
    dateBasis: "interview_date",
    reliableFrom: "2026-05-01",
    caution: "合計は interview.first と一致する。誰が付けたか・変更履歴は残らない。S は少数だが存在する",
  },
  proposal: {
    definition: "求人紹介（提案）。実績表の「紹介」と同一定義：JobEntry.job_intro_date ∪ ブックマーク（BOOKMARK）の COALESCE(出力日, 紹介日)。本人応募と自動引き当て由来は除く。records=件数、candidates=人数",
    dateBasis: "job_intro_date（〜2026-04）／ COALESCE(last_exported_at, introduced_at)（2026-04〜）",
    reliableFrom: "2026-04-01（記録方式が 2026-04 に切り替わった）",
    caution: "求人ツールへの出力（last_exported_at）は 2026-09 以降 0 件（出力廃止のため）。以後は introduced_at（マイページへの紹介）が基準",
  },
  bookmark: {
    definition: "ブックマーク（求人検索の保存）。created=作成件数（紹介保留を含む全件・担当軸）、createdAuto=そのうち自動引き当て由来、introduced=マイページへ紹介した件数（introduced_at）",
    dateBasis: "created=created_at、introduced=introduced_at",
    reliableFrom: "2026-04-01",
    caution: "日報の「求人検索」は登録した人の軸で数えるのに対し、ここは担当CA軸（登録者と担当が違うのは約4%）",
  },
  bookmarkRatingCurrent: {
    definition: "区切り内に作成したブックマークの、取得時点の総合評価（ai_match_rating）の分布。unrated=未評価",
    dateBasis: "created_at（ブックマーク作成日）",
    reliableFrom: "2026-04-01（5段階 B+ は 2026-07 T-146 以降）",
    caution: "『今の値』であり、再評価やCAの手直しで上書きされる。AIの判定かCAの修正かは区別できない",
  },
  aiRatingHistory: {
    definition: "AIによる求人評価の履歴（job_eval_records・status=SAVED）の総合評価の件数（A/B+/B/C/D/other）",
    dateBasis: "evaluated_at（無ければ created_at）",
    reliableFrom: "2026-09-25（履歴テーブルの開始日。それ以前の評価の推移は分からない）",
    caution: "AIが付けた値のみ。CAが手直しした結果は含まない（手直しは bookmarkRatingCurrent 側に反映される）",
  },
  entry: {
    definition: "エントリー（job_entries・entry_flag が 応募/エントリー/書類選考/面接/内定/入社済・アーカイブ除く）。records=件数（社数）、candidates=人数（同じ月に複数社へ出しても1人）",
    dateBasis: "entry_date",
    reliableFrom: "2026-05-01",
    caution: "company-kpi の entryCount は人数（こちらの entry.candidates と同じ）。件数と人数を混同しない",
  },
  entryOutcomeNow: {
    definition: "区切り内にエントリーした件のうち『取得時点で』辞退（declined=本人辞退・辞退受付済・辞退報告済）、見送り（rejected=選考落ち・見送り通知）、クローズ（closed）になっている件数",
    dateBasis: "entry_date（エントリー日。辞退・見送りの日付は記録されていない）",
    reliableFrom: "2026-05-01",
    caution: "辞退・見送りには日付が無いため『いつ辞退したか』は分からない。直近の区切りほど選考中が多く、結果が出ていない件は数に入らない（選考中を不合格として数えないこと）。選考ステータスの変更履歴は無い",
  },
  selection: {
    definition: "選考の各段階の日付が区切り内にある件数（records）と人数（candidates）。documentSubmit=書類提出、documentPass=書類通過、firstInterview/secondInterview/finalInterview=一次/二次/最終面接、companyInterview=一次・二次・最終のいずれか（人数は company-kpi の companyInterviewCount と同じ）、offer=内定、acceptance=承諾、join=入社",
    dateBasis: "job_entries の各 *_date（document_submit_date, document_pass_date, first/second/final_interview_date, offer_date, acceptance_date, join_date）",
    reliableFrom: "documentSubmit は 2026-06-01（それ以前は未入力）。他は 2026-05-01",
    caution: "二次面接は日付の入力が少ない（全期間で20件）。承諾は同一求職者が複数社で承諾すると件数>人数（例 2026-08 は 10件/9人）。入社には入社予定日も入る。到達ベース（その段階の日付があるか）であり、選考中の案件は不合格として数えない",
  },
  currentStatus: {
    definition: "取得時点の選考状況を段階ごとに数えたもの（期間に関係なく、アーカイブ以外の全エントリー）。entered=エントリー済み（書類提出前）、documentScreening=書類選考中、firstInterview/secondInterview/finalInterview=一次/二次/最終面接の段階、interviewOther=面接段階で詳細未分類、offered=内定（承諾前）、acceptedNotJoined=承諾済み未入社、joined=入社済、declined=辞退、rejected=見送り、closed=クローズ",
    dateBasis: "なし（取得時点の entry_flag / entry_flag_detail / person_flag / company_flag）",
    reliableFrom: "選考中の段階は現在の状態なので信頼できる。declined/rejected/closed/joined は全期間の累計（FileMaker 移行分を含む）",
    caution: "選考ステータスの変更履歴は無い。選考中の案件は不合格として数えない。辞退・見送りに日付は無い",
  },
  activity: {
    definition: "CA本人の操作回数（CAのユーザーID軸）。tasksCreated=起票したタスク、documentTasksCreated=そのうち書類作成依頼（履歴書・職務経歴書・推薦状）、advisorChatSessions=AIアドバイザーのチャット開始数、interviewPrepRooms=面談準備の部屋数、dailyReports=日報提出数、contactMails=求職者向け案内メール送信数",
    dateBasis: "created_at（日報は date、案内メールは sent_at）",
    reliableFrom: "タスク・チャット 2026-05-01、日報 2026-05-20、面談準備 2026-09-27、案内メール 2026-09-30",
    caution: "担当CA軸ではなく操作した本人の軸。groups=activity を指定したときだけ返す。全員行は全ユーザー（CA以外を含む）",
  },
} as const;

export const CA_KPI_CAVEATS = [
  "CA別の数値は求職者の『現在の』担当CAで集計している（attribution=current_ca）。担当替えの記録は caAssignmentHistorySince から始まり、それより前の担当替えは分からない",
  "面談時間は予約枠の長さ（30分・60分）であり、実際の長さではない",
  "ABCD判定（aiRatingHistory）は 2026-09-25 以降のみ。ブックマークの今の評価（bookmarkRatingCurrent）は AI の判定か CA の修正かを区別できない",
  "二次面接は日付の入力が少ない。書類提出日は 2026-06 以降。求人ツールへの出力は 2026-09 以降 0 件（出力廃止）",
  "選考ステータスの変更履歴は無い。辞退・見送りには日付が無い。選考中の案件を不合格として数えないこと",
  "2026-05 より前は FileMaker 時代のデータが混ざるため参考値。5か月程度のデータで季節性を断定しないこと",
  "当日を含む期間は未来の予約・未入力の分だけ値が動く。確定値は過去の月で見ること",
] as const;

/** 応答の上限（limits フィールド）。get_metric_definitions でも同じ内容を返す。 */
export const CA_KPI_LIMITS_PUBLIC = {
  dayMaxDays: CA_KPI_LIMITS.dayMaxDays,
  weekMonthMaxDays: CA_KPI_LIMITS.weekMonthMaxDays,
  maxRowsBytes: CA_KPI_LIMITS.maxRowsBytes,
  note: "全CA（8名+全員行）の月別・既定グループなら 8 か月まで。超えるときは期間を分ける・caId で絞る・groups を減らす",
} as const;

export interface CaKpiHttpResult {
  /** 200 / 400 / 404 */
  status: number;
  /** Response.json にそのまま渡す本文（エラー時は { error } ） */
  body: unknown;
}

/**
 * クエリ（from / to / granularity / caId / groups）から ca-kpi の本文を組み立てる。
 * 認証は呼び出し側（HTTP ルートは Bearer、MCP は秘密URL）で済ませてから呼ぶ。
 */
export async function buildCaKpiResponse(sp: URLSearchParams): Promise<CaKpiHttpResult> {
  const today = todayJstDateString();
  const parsed = parseCaKpiQuery(sp, today);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const qp = parsed.query;

  // CA 一覧は company-kpi と同条件（jobCategory='CA' かつ在籍）。caId 指定時は社員番号→無ければ Employee.id で引く。
  type Ca = { id: string; employeeNumber: string; name: string; userId: string | null };
  let cas: Ca[];
  if (qp.caId) {
    const ca =
      (await prisma.employee.findUnique({
        where: { employeeNumber: qp.caId },
        select: { id: true, employeeNumber: true, name: true, userId: true },
      })) ??
      (await prisma.employee.findUnique({
        where: { id: qp.caId },
        select: { id: true, employeeNumber: true, name: true, userId: true },
      }));
    if (!ca) return { status: 404, body: { error: `caId に該当する社員が見つかりません: ${qp.caId}` } };
    cas = [ca];
  } else {
    cas = await prisma.employee.findMany({
      where: { jobCategory: "CA", status: "active" },
      select: { id: true, employeeNumber: true, name: true, userId: true },
      orderBy: { employeeNumber: "asc" },
    });
  }

  const buckets = buildCaKpiBuckets(qp.from, qp.to, qp.granularity);
  const single = cas.length === 1 && qp.caId != null;
  // 応答サイズの上限（rows の推定バイト数）。全CA × 12 か月や全CA × day 粒度のような組み合わせはここで 400 にする。
  const tooBig = checkCaKpiSizeLimit(buckets.length, single ? 1 : cas.length + 1, qp.groups);
  if (tooBig) return { status: 400, body: { error: tooBig } };
  const [result, meta] = await Promise.all([
    computeCaKpi({
      buckets,
      groups: qp.groups,
      scope: { employeeId: single ? cas[0].id : null, userId: single ? cas[0].userId : null },
    }),
    queryCaKpiMeta(),
  ]);

  const caLabel = (ca: Ca) => ({ employeeNumber: ca.employeeNumber, ...(INCLUDE_CA_NAME ? { name: ca.name } : {}) });
  const wantActivity = qp.groups.includes("activity");
  const attachActivity = (m: CaKpiMetrics, grpUser: string | null, key: string): CaKpiMetrics => {
    if (!wantActivity) return m;
    const a = grpUser != null ? result.activityByUser.get(grpUser)?.get(key) : undefined;
    return { ...m, activity: a ?? m.activity };
  };

  // rows: 区切り × （全員 + 各CA）。caId 指定時は全員行を出さない（その CA の行だけ）。区切りの from/to は buckets 側に持つ。
  const rows: Array<{ ca: string; bucket: string } & CaKpiMetrics> = [];
  for (const b of buckets) {
    if (!single) {
      rows.push({ ca: CA_KPI_ALL, bucket: b.key, ...attachActivity(metricsFor(result, CA_KPI_ALL, b.key, qp.groups), CA_KPI_ALL, b.key) });
    }
    for (const ca of cas) {
      rows.push({ ca: ca.employeeNumber, bucket: b.key, ...attachActivity(metricsFor(result, ca.id, b.key, qp.groups), ca.userId, b.key) });
    }
  }

  const currentStatus: Array<{ ca: string } & ReturnType<typeof emptyCurrentStatus>> = [];
  if (!single) currentStatus.push({ ca: CA_KPI_ALL, ...(result.currentStatus.get(CA_KPI_ALL) ?? emptyCurrentStatus()) });
  for (const ca of cas) currentStatus.push({ ca: ca.employeeNumber, ...(result.currentStatus.get(ca.id) ?? emptyCurrentStatus()) });

  return {
    status: 200,
    body: {
      generatedAt: jstIso(new Date()),
      timezone: "Asia/Tokyo",
      scope: "CA_ONLY",
      attribution: "current_ca",
      caAssignmentHistorySince: jstYmd(meta.caAssignmentHistorySince),
      period: { from: qp.from, to: qp.to, requestedTo: qp.requestedTo, toClampedToToday: qp.toClamped },
      granularity: qp.granularity,
      bucketNote:
        qp.granularity === "week"
          ? "week は月曜〜日曜（実績表と同じ）。最初と最後の週は from/to で切り詰めた端数"
          : qp.granularity === "month"
            ? "month は暦月。最初と最後の月は from/to で切り詰めた端数（当月は今日まで）"
            : "day は JST の暦日",
      limits: CA_KPI_LIMITS_PUBLIC,
      groups: qp.groups,
      availableGroups: CA_KPI_GROUPS,
      dataFreshness: {
        interview_records: jstIso(meta.interviewRecordsUpdatedAt),
        job_entries: jstIso(meta.jobEntriesUpdatedAt),
        candidate_files: jstIso(meta.candidateFilesUpdatedAt),
      },
      caveats: CA_KPI_CAVEATS,
      definitions: CA_KPI_DEFINITIONS,
      caCount: cas.length,
      cas: cas.map(caLabel),
      allRowNote: single
        ? null
        : "ca='ALL' は全求職者の合算（担当なし・CA職種以外の担当の求職者も含む）。人数（candidates）は各CAの合計と一致しないことがある（期間全体の重複除去のため）",
      buckets: buckets.map((b) => ({ key: b.key, from: b.from, to: b.to })),
      rows,
      currentStatus,
    },
  };
}

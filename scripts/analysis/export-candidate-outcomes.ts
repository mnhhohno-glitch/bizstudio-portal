/**
 * T-181: 求職者の決定率分析用CSV出力（スカウト絞り込み見直しの材料）
 *
 * 実行（コンテナ上 / ローカル proxy いずれも可・**SELECT のみ**）:
 *   railway ssh --service bizstudio-portal
 *   npx tsx scripts/analysis/export-candidate-outcomes.ts --from 2025-10-01
 *   （ローカルから本番 proxy 経由で叩く場合: npx tsx --env-file=.env scripts/analysis/... ）
 *
 * 出力:
 *   docs/analysis/candidate_outcomes_YYYYMMDD.csv          … 1求職者=1行（.gitignore 済・コミットしない）
 *   docs/analysis/candidate_outcomes_summary_YYYYMMDD.md   … 集計サマリ（コミット対象）
 *
 * ※ 本スクリプトは INSERT/UPDATE/DELETE/DDL を一切含まない。読み取り専用。
 * ※ 氏名・メール・電話・住所の番地は出力しない。識別子は candidateNumber のみ、住所は都道府県まで。
 *
 * ============================================================================
 * 段階（面談・紹介・エントリー・内定・承諾）の定義
 * ============================================================================
 * src/lib/dailyReport/metrics.ts:computeCaMetricsForRange に**倣う**（独自定義を作らない）。
 * 違いは「CA 軸・期間窓での件数」ではなく「求職者ごとの累積」に読み替える点のみ。
 *
 *  - 初回面談実施 : InterviewRecord.interviewCount = 1 かつ 辞退系でない
 *                   （辞退系 = INTERVIEW_DECLINED_FLAGS。resultFlag IS NULL は実施扱い＝罠#37）
 *                   ※ 日程調整AIのプレースホルダ（status='draft'）は interviewCount=null のため自然に除外される
 *  - 求人検索     : CandidateFile.category='BOOKMARK' かつ archivedAt IS NULL
 *  - 求人紹介     : CandidateFile.category='BOOKMARK' かつ NOT(origin='candidate' AND driveFileId IS NULL)
 *                   かつ (lastExportedAt IS NOT NULL OR introducedAt IS NOT NULL)  ← T-161 の COALESCE 定義
 *  - エントリー   : JobEntry.archivedAt IS NULL かつ entryFlag ∈ {応募,エントリー,書類選考,面接,内定,入社済}
 *  - 書類通過/内定/承諾 : JobEntry.archivedAt IS NULL かつ documentPassDate / offerDate / acceptanceDate が非 NULL
 *
 * ============================================================================
 * Phase 0 スキーマ確認の結論（本番実データで裏取り済み・推測なし）
 * ============================================================================
 * 【重要1】Candidate.createdAt は「登録日」ではない。
 *   本番の min(created_at)=2026-02-17（FileMaker 一括移行の投入時刻。2026-02 だけで 3,638/4,389 件）。
 *   よって母集団の期間指定には使えない。本スクリプトは代わりに
 *     基準日 = COALESCE(scoutDeliveryDate, ScoutDeliverySlot.deliveryDate, applicationDate, createdAt)
 *   を「登録相当日」として --from/--to の判定に使い、由来（基準日ソース列）も併せて出す。
 *   scoutDeliveryDate は 4,195/4,389 件（95.6%）埋まっており 2024-01〜 の実期間を持つ。
 *
 * 【重要2】ScoutDeliverySlot.searchConditionName は**本番 64,829 行すべて NULL**（列はあるが未運用）。
 *   ターゲット層を表しうるのは deliveryCategoryLarge(RPA/社員) / Medium(個別配信/一斉配信) /
 *   Small(検索条件指定 or NULL) と 号機（ScoutMachineMaster.machineLabel）のみ。
 *   「登録日系／情報空欄層」のような層区分カラムは存在しない。
 *
 * 【存在しないフィールド（列を出さない）】
 *   - Candidate に 都道府県 / 年齢 / 最終学歴 の専用カラムは無い
 *       → 都道府県は address 先頭からパース（address 自体が 671/4,389＝15.3% しか無い）
 *       → 年齢は birthday から基準日時点で算出
 *       → 最終学歴は InterviewDetail.educationFlag（面談がある人のみ）
 *   - JobEntry.acceptanceStatus は無い → acceptanceDate の有無 + entryFlagDetail で代替
 *   - WorkHistory に 業種カラムは無い（businessContent＝事業内容の自由記述のみ）
 *   - WorkHistory に 雇用形態カラムは無い（jobTypeFlag に「雇用形態：正社員／…」が混ざる場合のみ抽出）
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INTERVIEW_DECLINED_FLAGS } from "../../src/lib/dailyReport/constants";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---------------------------------------------------------------- args
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FROM_STR = arg("from", "2025-10-01");
const TO_STR = arg("to", "");
/** 出力ファイル名の接尾辞（同日に複数期間を出し分ける用。例 --tag all → ..._20260825_all.csv） */
const TAG = arg("tag", "");
const OUT_DIR = arg("out", path.join(process.cwd(), "docs", "analysis"));

/** 除外するテストアカウント（.claude/10-test-users.md + 本番実データの名寄せ） */
const EXCLUDED_CANDIDATE_NUMBERS = new Set(["5999999", "5001221", "5008487"]);

// ---------------------------------------------------------------- JST helpers（罠#17: toISOString().slice(0,10) 禁止）
const jstDate = (d: Date | null | undefined): string =>
  d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "";
const jstDateTime = (d: Date | null | undefined): string =>
  d
    ? `${d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })} ${d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false })}`
    : "";
/** @db.Date 列（時刻なし）は UTC midnight 保存。JST 変換すると前日にずれるので UTC で読む。 */
const dbDate = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "");

const PREF_RE =
  /^\s*(北海道|東京都|(?:京都|大阪)府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県)/;
const prefectureOf = (address: string | null): string => {
  if (!address) return "";
  const m = PREF_RE.exec(address);
  return m ? m[1] : "";
};

/** 基準日時点の満年齢。birthday は壁時計日付として扱う。 */
const ageAt = (birthday: Date | null, at: Date | null): string => {
  if (!birthday || !at) return "";
  const b = birthday.toISOString().slice(0, 10).split("-").map(Number);
  const a = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).split("-").map(Number);
  let age = a[0] - b[0];
  if (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])) age -= 1;
  return age >= 0 && age < 120 ? String(age) : "";
};
const ageBand = (age: string): string => {
  if (!age) return "不明";
  const n = Number(age);
  if (n <= 24) return "〜24";
  if (n <= 29) return "25-29";
  if (n <= 34) return "30-34";
  if (n <= 39) return "35-39";
  return "40〜";
};

/** 自由記述は分析用に切り詰める（CSV 肥大と改行混入の防止）。 */
const short = (s: string | null | undefined, n = 200): string =>
  s ? s.replace(/[\r\n\t]+/g, " ").slice(0, n) : "";

// ---------------------------------------------------------------- main
type Row = Record<string, string>;

async function main() {
  const from = new Date(`${FROM_STR}T00:00:00+09:00`);
  const to = TO_STR ? new Date(`${TO_STR}T23:59:59.999+09:00`) : null;

  console.log(`[T-181] 母集団基準日 >= ${FROM_STR}${TO_STR ? ` かつ <= ${TO_STR}` : ""}`);

  // --- 1) 候補者本体 + スカウト配信枠 -------------------------------------
  const candidates = await prisma.candidate.findMany({
    select: {
      id: true,
      candidateNumber: true,
      gender: true,
      birthday: true,
      address: true,
      createdAt: true,
      supportStatus: true,
      supportSubStatus: true,
      supportEndReason: true,
      mediaSource: true,
      applicationRoute: true,
      applicationDate: true,
      scoutDeliveryDate: true,
      scoutNumber: true,
      masType: true,
      recruiterName: true,
      mynaviRegisteredDate: true,
      desiredJobType1: true,
      desiredIndustry1: true,
      desiredPrefecture1: true,
      desiredSalaryMin: true,
      employee: { select: { name: true } },
      scoutDeliverySlot: {
        select: {
          scoutNumber: true,
          deliveryDate: true,
          hourSlot: true,
          isMachine: true,
          isStaff: true,
          deliveryCategoryLarge: true,
          deliveryCategoryMedium: true,
          deliveryCategorySmall: true,
          mediaSource: true,
          searchConditionName: true,
          deliveryCount: true,
          openCount: true,
          isAggregationTarget: true,
          memo: true,
          machine: {
            select: { machineLabel: true, machineNumber: true, recruiterName: true, isMachine: true },
          },
        },
      },
    },
  });

  // 基準日（登録相当日）と母集団フィルタ
  type Cand = (typeof candidates)[number];
  const baseOf = (c: Cand): { basis: Date | null; source: string } => {
    if (c.scoutDeliveryDate) return { basis: c.scoutDeliveryDate, source: "scoutDeliveryDate" };
    if (c.scoutDeliverySlot?.deliveryDate)
      return { basis: c.scoutDeliverySlot.deliveryDate, source: "slot.deliveryDate" };
    if (c.applicationDate) return { basis: c.applicationDate, source: "applicationDate" };
    return { basis: c.createdAt, source: "createdAt(移行日)" };
  };

  const target = candidates.filter((c) => {
    if (EXCLUDED_CANDIDATE_NUMBERS.has(c.candidateNumber)) return false;
    const b = baseOf(c).basis;
    if (!b) return false;
    if (b < from) return false;
    if (to && b > to) return false;
    return true;
  });
  const ids = target.map((c) => c.id);
  console.log(
    `[T-181] 母集団: ${target.length} 名（全 ${candidates.length} 名中 / テスト ${EXCLUDED_CANDIDATE_NUMBERS.size} 件除外）`,
  );
  if (ids.length === 0) throw new Error("母集団が 0 件です");

  // --- 2) 面談 ------------------------------------------------------------
  const interviews = await prisma.interviewRecord.findMany({
    where: { candidateId: { in: ids } },
    select: {
      id: true,
      candidateId: true,
      interviewDate: true,
      interviewType: true,
      interviewCount: true,
      resultFlag: true,
      isLatest: true,
      status: true,
    },
    orderBy: { interviewDate: "asc" },
  });
  const declined = new Set<string>(INTERVIEW_DECLINED_FLAGS as readonly string[]);
  const isExecuted = (f: string | null) => f === null || !declined.has(f);

  type Iv = (typeof interviews)[number];
  const ivByCand = new Map<string, Iv[]>();
  for (const iv of interviews) {
    const arr = ivByCand.get(iv.candidateId) ?? [];
    arr.push(iv);
    ivByCand.set(iv.candidateId, arr);
  }

  // 「最新面談」= isLatest 優先、無ければ interviewDate 最大
  const latestIvId = new Map<string, string>();
  for (const [cid, arr] of ivByCand) {
    const flagged = arr.filter((x) => x.isLatest);
    const latest = flagged.length > 0 ? flagged[flagged.length - 1] : arr[arr.length - 1];
    if (latest) latestIvId.set(cid, latest.id);
  }

  // --- 3) 面談詳細（最新面談。詳細が無ければ詳細を持つ直近面談へフォールバック） ---
  const details = await prisma.interviewDetail.findMany({
    where: { interviewRecordId: { in: interviews.map((i) => i.id) } },
    select: {
      interviewRecordId: true,
      activityPeriod: true,
      employmentStatus: true,
      jobChangeTimeline: true,
      currentApplicationCount: true,
      educationFlag: true,
      graduationStatus: true,
      companyName: true,
      businessContent: true,
      tenure: true,
      jobTypeFlag: true,
      resignReasonLarge: true,
      resignReasonMedium: true,
      resignReasonSmall: true,
      jobChangeReasonMemo: true,
      jobChangeAxisFlag: true,
      desiredJobType1: true,
      desiredJobType2: true,
      desiredIndustry1: true,
      desiredEmploymentType: true,
      desiredPrefecture: true,
      desiredCity: true,
      desiredArea: true,
      currentSalary: true,
      desiredSalaryMin: true,
      desiredSalaryMax: true,
    },
  });
  type Det = (typeof details)[number];
  const detailByIv = new Map<string, Det>(details.map((d) => [d.interviewRecordId, d]));
  const detailOf = (cid: string): Det | null => {
    const lid = latestIvId.get(cid);
    if (lid && detailByIv.has(lid)) return detailByIv.get(lid)!;
    const arr = ivByCand.get(cid) ?? [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const d = detailByIv.get(arr[i].id);
      if (d) return d;
    }
    return null;
  };

  // --- 4) 職歴（面談レコード単位。直近＝hireDate 最大、無ければ order 最大） ---
  const works = await prisma.workHistory.findMany({
    where: { interviewRecordId: { in: interviews.map((i) => i.id) } },
    select: {
      interviewRecordId: true,
      order: true,
      businessContent: true,
      jobTypeFlag: true,
      tenureYear: true,
      tenureMonth: true,
      hireDate: true,
      leaveDate: true,
      resignReasonLarge: true,
      resignReasonMedium: true,
      resignReasonSmall: true,
      jobChangeReasonMemo: true,
    },
  });
  type Wh = (typeof works)[number];
  const workByIv = new Map<string, Wh[]>();
  for (const w of works) {
    const arr = workByIv.get(w.interviewRecordId) ?? [];
    arr.push(w);
    workByIv.set(w.interviewRecordId, arr);
  }
  /** 求職者の職歴 = その人の面談のうち職歴行を最も多く持つ面談のもの（職歴は面談ごとに独立保持のため） */
  const worksOf = (cid: string): Wh[] => {
    const arr = ivByCand.get(cid) ?? [];
    let best: Wh[] = [];
    for (const iv of arr) {
      const w = workByIv.get(iv.id) ?? [];
      if (w.length > best.length) best = w;
    }
    return best;
  };
  const latestWork = (ws: Wh[]): Wh | null => {
    if (ws.length === 0) return null;
    const sorted = [...ws].sort((a, b) => {
      const ha = a.hireDate ?? "";
      const hb = b.hireDate ?? "";
      if (ha !== hb) return ha < hb ? -1 : 1;
      return a.order - b.order;
    });
    return sorted[sorted.length - 1];
  };
  const EMP_RE = /雇用形態[：:]\s*([^／/、\s]+)/;

  // --- 5) ブックマーク（求人検索・紹介） -----------------------------------
  const bookmarks: Array<{
    candidate_id: string;
    searched: bigint;
    introduced: bigint;
    first_introduced: Date | null;
  }> = await prisma.$queryRaw`
      SELECT candidate_id,
             count(*) FILTER (WHERE archived_at IS NULL) AS searched,
             count(*) FILTER (
               WHERE NOT (origin = 'candidate' AND drive_file_id IS NULL)
                 AND (last_exported_at IS NOT NULL OR introduced_at IS NOT NULL)
             ) AS introduced,
             min(COALESCE(last_exported_at, introduced_at)) FILTER (
               WHERE NOT (origin = 'candidate' AND drive_file_id IS NULL)
                 AND (last_exported_at IS NOT NULL OR introduced_at IS NOT NULL)
             ) AS first_introduced
      FROM candidate_files
      WHERE category = 'BOOKMARK' AND candidate_id = ANY(${ids})
      GROUP BY candidate_id`;
  const bmByCand = new Map(bookmarks.map((b) => [b.candidate_id, b]));

  // --- 6) エントリー〜承諾 --------------------------------------------------
  const entries: Array<{
    candidate_id: string;
    entries: bigint;
    doc_pass: bigint;
    offers: bigint;
    acceptances: bigint;
    first_entry: Date | null;
    first_acceptance: Date | null;
    joined: bigint;
    flags: string | null;
  }> = await prisma.$queryRaw`
      SELECT candidate_id,
             count(*) FILTER (WHERE entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')) AS entries,
             count(*) FILTER (WHERE document_pass_date IS NOT NULL) AS doc_pass,
             count(*) FILTER (WHERE offer_date IS NOT NULL) AS offers,
             count(*) FILTER (WHERE acceptance_date IS NOT NULL) AS acceptances,
             min(entry_date) FILTER (WHERE entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')) AS first_entry,
             min(acceptance_date) AS first_acceptance,
             count(*) FILTER (WHERE join_date IS NOT NULL) AS joined,
             string_agg(DISTINCT entry_flag_detail, '|') FILTER (WHERE acceptance_date IS NOT NULL) AS flags
      FROM job_entries
      WHERE archived_at IS NULL AND candidate_id = ANY(${ids})
      GROUP BY candidate_id`;
  const enByCand = new Map(entries.map((e) => [e.candidate_id, e]));

  // --- 7) 行の組み立て ------------------------------------------------------
  const num = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

  const rows: Row[] = target.map((c) => {
    const b = baseOf(c);
    const slot = c.scoutDeliverySlot;
    const ivs = ivByCand.get(c.id) ?? [];
    const firstIv = ivs.find((x) => x.interviewCount === 1 && isExecuted(x.resultFlag)) ?? null;
    const executedIvs = ivs.filter((x) => (x.interviewCount ?? 0) >= 1 && isExecuted(x.resultFlag));
    const lastIv = ivs.length > 0 ? ivs[ivs.length - 1] : null;
    const d = detailOf(c.id);
    const ws = worksOf(c.id);
    const lw = latestWork(ws);
    const bm = bmByCand.get(c.id);
    const en = enByCand.get(c.id);

    const searched = num(bm?.searched);
    const introduced = num(bm?.introduced);
    const entryCount = num(en?.entries);
    const docPass = num(en?.doc_pass);
    const offers = num(en?.offers);
    const acceptances = num(en?.acceptances);

    // 結果ラベル（上から優先・1つだけ）
    const outcome =
      acceptances > 0
        ? "承諾"
        : offers > 0
          ? "内定止まり"
          : entryCount > 0
            ? "エントリー止まり"
            : introduced > 0
              ? "求人紹介止まり"
              : firstIv || executedIvs.length > 0
                ? "面談止まり"
                : "面談未実施";

    const age = ageAt(c.birthday, b.basis);
    const empType = lw?.jobTypeFlag ? (EMP_RE.exec(lw.jobTypeFlag)?.[1] ?? "") : "";

    return {
      // 識別・基本
      candidateNumber: c.candidateNumber,
      基準日: dbDate(b.basis),
      基準日月: dbDate(b.basis).slice(0, 7),
      基準日ソース: b.source,
      portal登録日時: jstDateTime(c.createdAt),
      担当CA: c.employee?.name ?? "",
      supportStatus: c.supportStatus,
      supportSubStatus: c.supportSubStatus ?? "",
      支援終了理由: c.supportEndReason ?? "",
      年齢: age,
      年齢帯: ageBand(age),
      性別:
        c.gender === "male" ? "男性" : c.gender === "female" ? "女性" : c.gender === "other" ? "その他" : "",
      都道府県: prefectureOf(c.address),
      最終学歴: d?.educationFlag ?? "",
      卒業区分: d?.graduationStatus ?? "",

      // 応募経路
      mediaSource: c.mediaSource ?? "",
      applicationRoute: c.applicationRoute ?? "",
      applicationDate: jstDate(c.applicationDate),
      scoutDeliveryDate: jstDate(c.scoutDeliveryDate),
      masType: c.masType ?? "",
      担当RC: c.recruiterName ?? "",
      scoutNumber: c.scoutNumber ?? "",
      マイナビ登録日: jstDate(c.mynaviRegisteredDate),

      // ScoutDeliverySlot（全フィールド）
      slot_スカウトNO: slot?.scoutNumber ?? "",
      slot_配信日: dbDate(slot?.deliveryDate),
      slot_配信時刻枠: slot ? String(slot.hourSlot) : "",
      slot_配信種別大: slot?.deliveryCategoryLarge ?? "",
      slot_配信種別中: slot?.deliveryCategoryMedium ?? "",
      slot_配信種別小: slot?.deliveryCategorySmall ?? "",
      slot_検索条件名: slot?.searchConditionName ?? "",
      slot_媒体: slot?.mediaSource ?? "",
      slot_号機: slot?.machine?.machineLabel ?? "",
      slot_号機番号: slot?.machine?.machineNumber != null ? String(slot.machine.machineNumber) : "",
      slot_担当者名: slot?.machine?.recruiterName ?? "",
      slot_isMachine: slot ? String(slot.isMachine) : "",
      slot_isStaff: slot ? String(slot.isStaff) : "",
      slot_配信数: slot ? String(slot.deliveryCount) : "",
      slot_開封数: slot ? String(slot.openCount) : "",
      slot_集計対象: slot ? String(slot.isAggregationTarget) : "",
      slot_メモ: short(slot?.memo, 100),
      "slot_ターゲット区分(合成)": slot
        ? [
            slot.deliveryCategoryLarge,
            slot.deliveryCategoryMedium ?? "種別中なし",
            slot.deliveryCategorySmall ?? "検索条件未指定",
          ].join("/")
        : "",

      // 面談
      初回面談日: jstDate(firstIv?.interviewDate ?? null),
      面談レコード数: String(ivs.length),
      面談実施回数: String(executedIvs.length),
      最新面談日: jstDate(lastIv?.interviewDate ?? null),
      最新面談種別: lastIv?.interviewType ?? "",
      最新面談結果フラグ: lastIv?.resultFlag ?? "",
      退職理由大: lw?.resignReasonLarge ?? d?.resignReasonLarge ?? "",
      退職理由中: lw?.resignReasonMedium ?? d?.resignReasonMedium ?? "",
      退職理由小: lw?.resignReasonSmall ?? d?.resignReasonSmall ?? "",
      転職理由メモ: short(lw?.jobChangeReasonMemo ?? d?.jobChangeReasonMemo),
      転職軸: d?.jobChangeAxisFlag ?? "",
      活動期間: d?.activityPeriod ?? "",
      在職状況: d?.employmentStatus ?? "",
      転職希望時期: d?.jobChangeTimeline ?? "",
      現在の応募社数: d?.currentApplicationCount != null ? String(d.currentApplicationCount) : "",
      現年収: d?.currentSalary != null ? String(d.currentSalary) : "",
      希望年収下限:
        d?.desiredSalaryMin != null
          ? String(d.desiredSalaryMin)
          : c.desiredSalaryMin != null
            ? String(c.desiredSalaryMin)
            : "",
      希望年収上限: d?.desiredSalaryMax != null ? String(d.desiredSalaryMax) : "",
      希望勤務地都道府県: d?.desiredPrefecture ?? c.desiredPrefecture1 ?? "",
      希望勤務地エリア: d?.desiredArea ?? "",
      希望職種1: d?.desiredJobType1 ?? c.desiredJobType1 ?? "",
      希望職種2: d?.desiredJobType2 ?? "",
      希望業種1: d?.desiredIndustry1 ?? c.desiredIndustry1 ?? "",
      希望雇用形態: d?.desiredEmploymentType ?? "",

      // 職歴
      職歴社数: ws.length > 0 ? String(ws.length) : "",
      直近職種: lw?.jobTypeFlag ?? d?.jobTypeFlag ?? "",
      "直近事業内容(業種相当)": short(lw?.businessContent ?? d?.businessContent, 80),
      直近在籍月数: lw ? String((lw.tenureYear ?? 0) * 12 + (lw.tenureMonth ?? 0)) : "",
      直近入社年月: lw?.hireDate ?? "",
      直近退社年月: lw?.leaveDate ?? "",
      "直近雇用形態(職種欄から抽出)": empType,

      // 進捗
      求人検索あり: searched > 0 ? "1" : "0",
      求人検索件数: String(searched),
      求人紹介あり: introduced > 0 ? "1" : "0",
      求人紹介件数: String(introduced),
      初回紹介日: jstDate(bm?.first_introduced ?? null),
      エントリー件数: String(entryCount),
      初回エントリー日: jstDate(en?.first_entry ?? null),
      書類通過件数: String(docPass),
      内定件数: String(offers),
      承諾件数: String(acceptances),
      承諾日: jstDate(en?.first_acceptance ?? null),
      入社件数: String(num(en?.joined)),
      承諾後ステータス: en?.flags ?? "",
      outcome,
    };
  });

  // --- 8) CSV 出力 ----------------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp =
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/-/g, "") + (TAG ? `_${TAG}` : "");
  const headers = Object.keys(rows[0]);
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv =
    "﻿" +
    [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n") +
    "\r\n";
  const csvPath = path.join(OUT_DIR, `candidate_outcomes_${stamp}.csv`);
  writeFileSync(csvPath, csv, "utf8");
  console.log(`[T-181] CSV: ${csvPath}（${rows.length} 行 × ${headers.length} 列）`);

  // --- 9) サマリ md ---------------------------------------------------------
  const OUTCOMES = ["承諾", "内定止まり", "エントリー止まり", "求人紹介止まり", "面談止まり", "面談未実施"];
  const cross = (title: string, key: string) => {
    const buckets = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = r[key] || "(空欄)";
      const cell = buckets.get(k) ?? Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
      cell[r.outcome] = (cell[r.outcome] ?? 0) + 1;
      buckets.set(k, cell);
    }
    const lines = [
      `### ${title}`,
      "",
      `| 区分 | 件数 | ${OUTCOMES.join(" | ")} | 承諾率 | 面談到達率 |`,
      `|--|--:|${OUTCOMES.map(() => "--:").join("|")}|--:|--:|`,
    ];
    const sorted = [...buckets.entries()].sort(
      (a, b) =>
        Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0),
    );
    for (const [k, cell] of sorted) {
      const total = Object.values(cell).reduce((x, y) => x + y, 0);
      const interviewed = total - (cell["面談未実施"] ?? 0);
      lines.push(
        `| ${k} | ${total} | ${OUTCOMES.map((o) => cell[o] ?? 0).join(" | ")} | ${(((cell["承諾"] ?? 0) / total) * 100).toFixed(1)}% | ${((interviewed / total) * 100).toFixed(1)}% |`,
      );
    }
    lines.push("");
    return lines.join("\n");
  };

  const filled = (h: string) => rows.filter((r) => r[h] !== "" && r[h] !== null && r[h] !== undefined).length;
  const fillStats = headers.map((h) => ({ h, n: filled(h) })).sort((a, b) => a.n - b.n);
  const fillLines = fillStats.map(
    ({ h, n }) => `| ${h} | ${n} / ${rows.length} | ${((n / rows.length) * 100).toFixed(1)}% |`,
  );
  const lowFill = fillStats.filter(({ n }) => n / rows.length < 0.5);

  const outcomeCounts = OUTCOMES.map((o) => ({ o, n: rows.filter((r) => r.outcome === o).length }));

  const md = `# T-181 求職者アウトカム分析 サマリ

- 生成日（JST）: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
- 生成元: \`scripts/analysis/export-candidate-outcomes.ts --from ${FROM_STR}${TO_STR ? ` --to ${TO_STR}` : ""}\`
- データ源: 本番 Postgres（**SELECT のみ**）
- CSV: \`docs/analysis/candidate_outcomes_${stamp}.csv\`（**コミット対象外**・${rows.length} 行 × ${headers.length} 列）

## 0. 読む前に知っておくこと（データ側の制約）

1. **\`Candidate.createdAt\` は登録日ではない**。本番の最古が 2026-02-17（FileMaker 一括移行の投入時刻）で、
   4,389 名中 3,638 名が 2026-02 に集中する。よって母集団の期間指定には使えない。
   本CSVは \`基準日 = COALESCE(scoutDeliveryDate, slot.deliveryDate, applicationDate, createdAt)\` を
   「登録相当日」として採用し、由来を \`基準日ソース\` 列に出している。
2. **\`ScoutDeliverySlot.searchConditionName\` は本番 64,829 行すべて NULL**（列はあるが未運用）。
   検索条件・ターゲット層を表しうるのは \`配信種別大(RPA/社員)\` \`配信種別中(個別配信/一斉配信)\`
   \`配信種別小(検索条件指定 or NULL)\` \`号機\` のみ。層区分（登録日系／情報空欄層 等）のカラムは**存在しない**。
3. \`mediaSource\` / \`applicationRoute\` は Candidate 全体では 15% 前後しか埋まっていない（本母集団では約 49%）。
   実質的な媒体は \`slot_媒体\`（配信枠側）を見るほうが埋まっている。なお \`mediaSource\` が空欄の層は
   基準日 2023-11〜2026-06、\`マイナビ転職\` の層は 2024-05〜2026-08 と**期間が重なっており**、
   空欄＝古いデータとは言い切れない（記入運用の差が混ざる）。
4. **観測期間バイアス**: 承諾までの日数ぶん、基準日が新しい層は構造的に承諾率が低く出る。
   媒体・区分の比較は「基準日（月）× outcome」表で成熟度を確認してから読むこと。
5. **求人検索・求人紹介（BOOKMARK 台帳）は 2026-03 以降しか存在しない**（portal 稼働以降。
   本番の BOOKMARK は 2026-03 の 55 件が最古）。よって基準日が 2026-03 より前の層は
   \`求人紹介止まり\` が構造的に 0 件になり、その分が \`面談止まり\`／\`エントリー止まり\` に寄る。
   「紹介まで行ったか」で層を比較したい場合は **基準日 2026-03 以降に限定**すること。
   なお \`エントリー件数\`（JobEntry）は FileMaker 移行分を含むため全期間で連続している。

## 1. 母集団

- 対象: 基準日（JST）が ${FROM_STR} 以降${TO_STR ? ` ${TO_STR} 以前` : ""}の求職者
- 除外: テストアカウント ${[...EXCLUDED_CANDIDATE_NUMBERS].join(" / ")}
- **母集団 ${rows.length} 名**

### outcome 別

| outcome | 件数 | 割合 |
|--|--:|--:|
${outcomeCounts.map((x) => `| ${x.o} | ${x.n} | ${((x.n / rows.length) * 100).toFixed(1)}% |`).join("\n")}
| 合計 | ${rows.length} | 100.0% |

## 2. 各列の空欄率（値あり件数 / 全件）

空欄率が高い列は分析に使えない。少ない順。

| 列 | 値あり | 充填率 |
|--|--:|--:|
${fillLines.join("\n")}

### 充填率 50% 未満（＝分析に使いにくい列）

${lowFill.length === 0 ? "なし" : lowFill.map(({ h, n }) => `- \`${h}\` … ${n}/${rows.length}（${((n / rows.length) * 100).toFixed(1)}%）`).join("\n")}

## 3. クロス集計

${cross("mediaSource × outcome", "mediaSource")}
${cross("applicationRoute × outcome", "applicationRoute")}
${cross("配信ターゲット区分（大/中/小）× outcome", "slot_ターゲット区分(合成)")}
${cross("号機 × outcome", "slot_号機")}
${cross("MAS種別（開放日/通常）× outcome", "masType")}
${cross("slot_媒体 × outcome", "slot_媒体")}
${cross("年齢帯 × outcome", "年齢帯")}
${cross("基準日（月）× outcome ※観測期間バイアスの確認用", "基準日月")}
${cross("退職理由（大）× outcome", "退職理由大")}
${cross("性別 × outcome", "性別")}
${cross("最終学歴 × outcome", "最終学歴")}

## 4. Phase 0 で「存在しなかった」フィールド

| 探したもの | 結論 | 代替 |
|--|--|--|
| Candidate の都道府県 | 専用カラム無し | \`address\` 先頭からパース（\`address\` 自体が 15.3% しか無い） |
| Candidate の年齢 | 専用カラム無し | \`birthday\` から基準日時点で算出 |
| Candidate の最終学歴 | 専用カラム無し | \`InterviewDetail.educationFlag\`（面談実施者のみ） |
| ScoutDeliverySlot の検索条件名 | 列はあるが**全件 NULL** | 配信種別大/中/小 + 号機 |
| ScoutDeliverySlot のターゲット層区分 | **カラム自体が無い** | 同上 |
| JobEntry.acceptanceStatus | 列無し | \`acceptanceDate\` の有無 + \`entryFlagDetail\`（承諾後ステータス列） |
| WorkHistory の業種 | 列無し | \`businessContent\`（事業内容の自由記述） |
| WorkHistory の雇用形態 | 列無し | \`jobTypeFlag\` に「雇用形態：…」が混在するのは**本番 1,053 行中 3 行のみ**。実質使えない |
| InterviewDetail.jobChangeAxisFlag（転職軸） | 列はあるが**全 2,850 行 NULL** | 代替なし（\`転職理由メモ\` の自由記述のみ） |
| InterviewDetail.employmentStatus（在職状況） | 列はあるが 12/2,850 のみ | 代替なし |

## 5. 段階判定の定義（\`src/lib/dailyReport/metrics.ts\` 準拠）

| 段階 | 判定 |
|--|--|
| 初回面談実施 | \`InterviewRecord.interviewCount = 1\` かつ resultFlag が辞退系でない（NULL は実施扱い） |
| 求人検索 | \`CandidateFile.category='BOOKMARK'\` かつ \`archivedAt IS NULL\` |
| 求人紹介 | BOOKMARK かつ NOT(origin='candidate' AND driveFileId IS NULL) かつ (lastExportedAt or introducedAt が非NULL) |
| エントリー | \`JobEntry.archivedAt IS NULL\` かつ entryFlag ∈ {応募,エントリー,書類選考,面接,内定,入社済} |
| 書類通過 / 内定 / 承諾 | 同 archivedAt IS NULL かつ documentPassDate / offerDate / acceptanceDate が非 NULL |

outcome は上から順に1つだけ付与: 承諾 → 内定止まり → エントリー止まり → 求人紹介止まり → 面談止まり → 面談未実施。
`;

  const mdPath = path.join(OUT_DIR, `candidate_outcomes_summary_${stamp}.md`);
  writeFileSync(mdPath, md, "utf8");
  console.log(`[T-181] サマリ: ${mdPath}`);
  console.log(`[T-181] outcome: ${outcomeCounts.map((x) => `${x.o}=${x.n}`).join(" / ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

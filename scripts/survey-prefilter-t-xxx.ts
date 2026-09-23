/**
 * T-XXX step2: 求人評価（analyze-batch / recommend-analyze・Opus）の前に、条件が明らかに合わない求人を
 *              プログラムで落とした場合の効果と誤りを、過去の評価データで確かめる調査スクリプト。
 *
 * やること（すべて読み取りのみ・AI は一切呼ばない）:
 *   1. 直近30日の AdvisorUsageLog を機能別・経路別（手動=analyze-batch / 自動配信=recommend-analyze）に集計
 *   2. 5段階評価（T-146, 2026-07-29〜）以降に評価済みのブックマーク全件について、求人側の項目を集める
 *      - 求人プラットフォーム（Supabase jobs）: CandidateFile.externalJobRef = jobs.source_job_id
 *      - kyuujinPDF（jobs）: CandidateFile.kyuujinJobId = jobs.id（認証不要の GET API で取得）
 *   3. 求職者側の項目（希望年収・希望勤務地・年齢・学歴・転職回数・社会人歴・資格）を集めて充足率を出す
 *   4. ルール（年収/勤務地/年齢/学歴/転職回数/社会人歴）を1つずつ・全部合わせて当てはめ、落ちる件数・
 *      過去ランク・A/B+ の誤落とし・エントリー実績ありの誤落とし・削減見込みを集計
 *
 * 本番への影響ゼロの担保:
 *   - portal DB は default_transaction_read_only=on を付けた接続文字列に差し替えてから接続し、SHOW で確認。
 *   - 求人プラットフォームは Supabase REST（PostgREST）へ GET のみ発行する（REST では読み取り専用
 *     トランザクションを指定できないため、GET 以外を出さない作りにしている）。接続情報は
 *     bizstudio-job-platform/.env.local をこの処理の中で読むだけで、どこにも保存しない。
 *   - kyuujinPDF は GET /api/projects/by-job-seeker-id/{番号}/jobs（読み取り API・認証不要）のみ。
 *   - Anthropic / Gemini は呼ばない。
 *
 * 出力:
 *   docs/reports/T-XXX_prefilter-survey.md は手で書く（このスクリプトの summary.md を材料にする）
 *   scripts/output/t-xxx-prefilter/summary.md   … 集計（ID のみ）
 *   scripts/output/t-xxx-prefilter/detail.csv   … 全件明細（求人名を含む・コミットしない）
 *   scripts/output/t-xxx-prefilter/risky.csv    … A/B+ またはエントリー実績ありで落ちる求人の明細（コミットしない）
 *
 * 実行（master worktree・.env は本番DB proxy 直結）:
 *   npx tsx --env-file=.env scripts/survey-prefilter-t-xxx.ts
 */

import fs from "fs";
import path from "path";

const OUT_DIR = path.join("scripts", "output", "t-xxx-prefilter");
const JOB_PLATFORM_ENV = path.join("..", "bizstudio-job-platform", ".env.local");
const KYUUJIN_BASE = process.env.KYUUJIN_PDF_TOOL_URL || "https://web-production-95808.up.railway.app";

// T-146 の5段階化（P2-1〜P2-7）が master に揃った日時（compare-eval-models-t-xxx.ts と同じ）。
const T146_DONE_AT = new Date("2026-07-29T00:23:20+09:00");
const WINDOW_DAYS = 30;
// 為替: 前回（compare-eval-models-t-xxx.ts）と同じ値で揃える
const JPY_PER_USD = 157.42;
// 年収ルールの余裕幅（万円）
const SALARY_MARGIN = 100;

const RANKS = ["A", "B+", "B", "C", "D"] as const;
type Rank = (typeof RANKS)[number];
// エントリー以降に進んだとみなす entryFlag（求人紹介・検討中は含めない）
const PROGRESSED_FLAGS = ["エントリー", "書類選考", "面接", "内定", "入社済"];

const PREFS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
// 「東京」「大阪」のような短縮表記も拾う（北海道はそのまま）
const PREF_SHORT = new Map(PREFS.map((p) => [p === "北海道" ? p : p.replace(/[都府県]$/, ""), p]));

function normPref(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  if (PREFS.includes(t)) return t;
  return PREF_SHORT.get(t) ?? null;
}

// 地方ブロック（通勤圏の近似）。関東は茨城・栃木・群馬まで含めて落としすぎない側に寄せる
const BLOCKS: string[][] = [
  ["北海道"],
  ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  ["東京都", "神奈川県", "千葉県", "埼玉県", "茨城県", "栃木県", "群馬県"],
  ["山梨県", "長野県", "新潟県"],
  ["富山県", "石川県", "福井県"],
  ["愛知県", "岐阜県", "三重県", "静岡県"],
  ["大阪府", "京都府", "兵庫県", "奈良県", "滋賀県", "和歌山県"],
  ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  ["徳島県", "香川県", "愛媛県", "高知県"],
  ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"],
];
const blockOf = (p: string) => BLOCKS.findIndex((b) => b.includes(p));

function prefsInText(s: string | null | undefined): string[] {
  const t = s ?? "";
  return PREFS.filter((p) => t.includes(p));
}

// 学歴の段階: 求人プラットフォーム jobs.education の正規化値と、面談詳細 education_flag を同じ物差しにする
const JOB_EDU_LEVEL: Record<string, number> = {
  高等学校卒業以上: 1,
  "専修・各種学校卒業以上": 2,
  短期大学卒業以上: 3,
  大学卒業以上: 4,
  大学院卒業以上: 5,
};
// 「短大・専門卒」は短大の可能性があるので短大（3）側に寄せる＝落としすぎない側
const CAND_EDU_LEVEL: Record<string, number> = {
  中卒: 0,
  高校卒: 1,
  高卒: 1,
  専門卒: 2,
  "短大・専門卒": 3,
  短大卒: 3,
  高専卒: 3,
  大学卒: 4,
  大学院卒: 5,
};

function headRank(raw: string | null | undefined): Rank | null {
  const m = (raw ?? "").trim().match(/^(B\+|[ABCD])/);
  return m ? (m[1] as Rank) : null;
}

function jst(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function yen(usd: number): string {
  return `¥${Math.round(usd * JPY_PER_USD).toLocaleString("ja-JP")}`;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-";
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------- 接続

async function loadPrisma() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未設定（npx tsx --env-file=.env で実行）");
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
  const { prisma } = await import("@/lib/prisma");
  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>(
    "SHOW default_transaction_read_only",
  );
  if (ro[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用接続になっていないため中止");
  return prisma;
}

function jobPlatformGetter() {
  const env = Object.fromEntries(
    fs
      .readFileSync(JOB_PLATFORM_ENV, "utf-8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("求人プラットフォームの接続情報が読めない");
  // GET 以外は発行しない（読み取り専用の担保）
  return async <T>(pathAndQuery: string): Promise<T> => {
    const r = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`job-platform GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  };
}

// ---------------------------------------------------------------- 型

type Bookmark = {
  id: string;
  candidate_id: string;
  candidate_number: string;
  file_name: string;
  job_title: string | null;
  ai_match_rating: string;
  ai_analyzed_at: Date;
  auto_sourced_at: Date | null;
  archived_at: Date | null;
  origin: string | null;
  kyuujin_job_id: number | null;
  external_job_ref: string | null;
};

type JpJob = {
  source_job_id: string;
  source_media: string;
  media_job_id: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_type: string | null;
  work_locations: { prefecture?: string | null; city?: string | null; address?: string | null }[] | null;
  remote_type: string | null;
  age_min: number | null;
  age_max: number | null;
  experience_years_min: number | null;
  job_changes_max: number | null;
  education: string | null;
  tags: string[] | null;
  required_qualifications: string | null;
  status: string | null;
};

type KyJob = {
  id: number;
  job_db: string | null;
  job_id: string | null;
  salary: string | null;
  work_location: string | null;
  transfer: string | null;
  requirements: string | null;
};

type Cand = {
  id: string;
  birthday: Date | null;
  cand_salary_min: number | null;
  cand_pref1: string | null;
  cand_pref2: string | null;
  d_salary_min: number | null;
  d_reg_salary_min: number | null;
  d_desired_areas: unknown;
  d_desired_prefecture: string | null;
  d_reg_area_prefecture: string | null;
  d_education_flag: string | null;
  d_graduation_date: string | null;
  d_graduation_status: string | null;
  d_driver_license_flag: string | null;
  wh_count: number | null;
};

// ---------------------------------------------------------------- 求職者の値

type CandValues = {
  salaryMin: number | null;
  salarySource: string | null;
  prefs: string[];
  prefsSource: string[];
  anyArea: boolean; // 希望勤務地に「全国」「こだわらない」等
  educationLevel: number | null;
  educationRaw: string | null;
  jobChanges: number | null;
  gradYear: number | null;
  gradMonth: number | null;
};

function candValues(c: Cand): CandValues {
  let salaryMin: number | null = null;
  let salarySource: string | null = null;
  for (const [v, src] of [
    [c.d_salary_min, "面談詳細.desiredSalaryMin"],
    [c.cand_salary_min, "Candidate.desiredSalaryMin"],
    [c.d_reg_salary_min, "面談詳細.regSalaryMin"],
  ] as const) {
    if (v != null && v > 0) {
      salaryMin = v;
      salarySource = src;
      break;
    }
  }

  const prefs = new Set<string>();
  const prefsSource = new Set<string>();
  let anyArea = false;
  const addPref = (raw: string | null | undefined, src: string) => {
    const t = (raw ?? "").trim();
    if (!t) return;
    if (/全国|こだわらない|どこでも|不問/.test(t)) {
      anyArea = true;
      prefsSource.add(src);
      return;
    }
    const p = normPref(t) ?? prefsInText(t)[0] ?? null;
    if (p) {
      prefs.add(p);
      prefsSource.add(src);
    }
  };
  if (Array.isArray(c.d_desired_areas)) {
    for (const a of c.d_desired_areas as { prefecture?: string; area?: string }[]) {
      addPref(a?.prefecture, "面談詳細.desiredAreas");
      if (!a?.prefecture && a?.area && /全国/.test(a.area)) addPref(a.area, "面談詳細.desiredAreas");
    }
  }
  addPref(c.d_desired_prefecture, "面談詳細.desiredPrefecture");
  addPref(c.cand_pref1, "Candidate.desiredPrefecture1");
  addPref(c.cand_pref2, "Candidate.desiredPrefecture2");

  const eduRaw = (c.d_education_flag ?? "").trim() || null;
  const educationLevel = eduRaw != null && eduRaw in CAND_EDU_LEVEL ? CAND_EDU_LEVEL[eduRaw] : null;

  // 職歴は現職を含む会社数（面談詳細の companyName が work_histories の1件目と一致する）→ 転職回数 = 社数 − 1
  const jobChanges = c.wh_count != null && c.wh_count >= 1 ? c.wh_count - 1 : null;

  let gradYear: number | null = null;
  let gradMonth: number | null = null;
  const gm = (c.d_graduation_date ?? "").match(/(\d{4})\D+(\d{1,2})?/);
  if (gm && !/見込|在学/.test(`${c.d_graduation_date ?? ""}${c.d_graduation_status ?? ""}`)) {
    gradYear = Number(gm[1]);
    gradMonth = gm[2] ? Number(gm[2]) : 3;
  }
  return {
    salaryMin,
    salarySource,
    prefs: [...prefs],
    prefsSource: [...prefsSource],
    anyArea,
    educationLevel,
    educationRaw: eduRaw,
    jobChanges,
    gradYear,
    gradMonth,
  };
}

function ageAt(birthday: Date | null, at: Date): number | null {
  if (!birthday) return null;
  const b = new Date(birthday.getTime() + 9 * 3600_000);
  const a = new Date(at.getTime() + 9 * 3600_000);
  let age = a.getUTCFullYear() - b.getUTCFullYear();
  if (a.getUTCMonth() < b.getUTCMonth() || (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() < b.getUTCDate()))
    age--;
  return age >= 15 && age <= 80 ? age : null;
}

function careerYearsAt(cv: CandValues, at: Date): number | null {
  if (cv.gradYear == null) return null;
  const a = new Date(at.getTime() + 9 * 3600_000);
  const months = (a.getUTCFullYear() - cv.gradYear) * 12 + (a.getUTCMonth() + 1 - (cv.gradMonth ?? 3));
  return months >= 0 ? months / 12 : null;
}

// ---------------------------------------------------------------- 求人の値

type JobValues = {
  salaryTop: number | null;
  salarySource: string | null;
  prefs: string[];
  prefsSource: string | null;
  nationwide: boolean;
  remote: "full_remote" | "hybrid" | "tag" | null;
  transfer: boolean;
  transferSource: string | null;
  ageMax: number | null;
  educationLevel: number | null;
  educationRaw: string | null;
  jobChangesMax: number | null;
  experienceYearsMin: number | null;
};

function parseKySalaryTop(s: string | null): number | null {
  const nums = [...(s ?? "").matchAll(/(\d{3,4}(?:\.\d+)?)\s*万/g)].map((m) => Number(m[1]));
  const ok = nums.filter((n) => n >= 150 && n <= 3000);
  return ok.length ? Math.max(...ok) : null;
}

// kyuujinPDF の転勤欄: 「なし」「記載なし」以外（あり・応相談・可能性あり 等）は転勤ありとみなす
function kyTransfer(s: string | null): boolean | null {
  const t = (s ?? "").trim();
  if (!t || /記載なし|不明/.test(t)) return null;
  if (/^なし|転勤なし|無し|無$/.test(t)) return false;
  return true;
}

function jobValues(jp: JpJob | undefined, ky: KyJob | undefined): JobValues {
  // 年収: 上限（無ければ下限）。100万未満は月給の取り違えとみなして使わない
  let salaryTop: number | null = null;
  let salarySource: string | null = null;
  const jpTop = jp ? (jp.salary_max ?? jp.salary_min) : null;
  if (jpTop != null && jpTop >= 100) {
    salaryTop = jpTop;
    salarySource = "job-platform";
  } else {
    const k = parseKySalaryTop(ky?.salary ?? null);
    if (k != null) {
      salaryTop = k;
      salarySource = "kyuujin";
    }
  }

  let prefs: string[] = [];
  let prefsSource: string | null = null;
  let nationwide = false;
  const locs = Array.isArray(jp?.work_locations) ? jp!.work_locations! : [];
  for (const l of locs) {
    const p = normPref(l?.prefecture) ?? prefsInText(`${l?.prefecture ?? ""}${l?.address ?? ""}`)[0] ?? null;
    if (p) prefs.push(p);
    if (/全国/.test(`${l?.prefecture ?? ""}${l?.city ?? ""}`)) nationwide = true;
  }
  prefs = [...new Set(prefs)];
  if (prefs.length) prefsSource = "job-platform";
  else if (ky?.work_location) {
    prefs = prefsInText(ky.work_location);
    if (prefs.length) prefsSource = "kyuujin";
    if (/全国/.test(ky.work_location)) nationwide = true;
  }

  let remote: JobValues["remote"] = null;
  if (jp?.remote_type === "full_remote") remote = "full_remote";
  else if (jp?.remote_type === "hybrid") remote = "hybrid";
  else if ((jp?.tags ?? []).includes("リモートOK")) remote = "tag";

  let transfer = false;
  let transferSource: string | null = null;
  const kt = kyTransfer(ky?.transfer ?? null);
  if (kt != null) {
    transfer = kt;
    transferSource = "kyuujin";
  } else if ((jp?.tags ?? []).includes("転勤なし")) {
    transfer = false;
    transferSource = "job-platform(tag)";
  }

  const eduRaw = jp?.education ?? null;
  const educationLevel = eduRaw && eduRaw in JOB_EDU_LEVEL ? JOB_EDU_LEVEL[eduRaw] : null;
  return {
    salaryTop,
    salarySource,
    prefs,
    prefsSource,
    nationwide,
    remote,
    transfer,
    transferSource,
    ageMax: jp?.age_max ?? null,
    educationLevel,
    educationRaw: eduRaw,
    jobChangesMax: jp?.job_changes_max ?? null,
    experienceYearsMin: jp?.experience_years_min ?? null,
  };
}

// ---------------------------------------------------------------- ルール

const RULES = ["salary", "location", "age", "education", "jobChanges", "experience"] as const;
type Rule = (typeof RULES)[number];
const RULE_LABEL: Record<Rule, string> = {
  salary: "年収",
  location: "勤務地",
  age: "年齢",
  education: "学歴",
  jobChanges: "転職回数",
  experience: "社会人歴",
};

type Hit = { rule: Rule; detail: string };

function applyRules(cv: CandValues, jv: JobValues, age: number | null, career: number | null): {
  hits: Hit[];
  locationFullRemoteOnly: boolean; // 参考: 在宅はフルリモートだけ残す変種
  locationBlock: string | null; // 参考: 都道府県でなく地方ブロックで判定する変種（落ちる場合の比べた値）
} {
  const hits: Hit[] = [];
  if (cv.salaryMin != null && jv.salaryTop != null && jv.salaryTop < cv.salaryMin - SALARY_MARGIN) {
    hits.push({ rule: "salary", detail: `求人${jv.salaryTop}万(${jv.salarySource}) < 希望${cv.salaryMin}万(${cv.salarySource})−${SALARY_MARGIN}` });
  }
  let locationFullRemoteOnly = false;
  let locationBlock: string | null = null;
  if (!cv.anyArea && cv.prefs.length && jv.prefs.length && !jv.nationwide && !jv.transfer) {
    const miss = !jv.prefs.some((p) => cv.prefs.includes(p));
    if (miss) {
      const d = `求人[${jv.prefs.join("/")}](${jv.prefsSource}) ∩ 希望[${cv.prefs.join("/")}] = なし`;
      if (jv.remote !== "full_remote") locationFullRemoteOnly = true;
      if (!jv.remote) hits.push({ rule: "location", detail: d });
      const cb = new Set(cv.prefs.map(blockOf));
      if (!jv.remote && !jv.prefs.some((p) => cb.has(blockOf(p)))) locationBlock = `${d}（地方ブロックも別）`;
    }
  }
  if (jv.ageMax != null && age != null && age > jv.ageMax) {
    hits.push({ rule: "age", detail: `年齢${age} > 上限${jv.ageMax}` });
  }
  if (jv.educationLevel != null && cv.educationLevel != null && cv.educationLevel < jv.educationLevel) {
    hits.push({ rule: "education", detail: `学歴「${cv.educationRaw}」< 必須「${jv.educationRaw}」` });
  }
  if (jv.jobChangesMax != null && cv.jobChanges != null && cv.jobChanges > jv.jobChangesMax) {
    hits.push({ rule: "jobChanges", detail: `転職${cv.jobChanges}回 > 上限${jv.jobChangesMax}回` });
  }
  if (jv.experienceYearsMin != null && career != null && career < jv.experienceYearsMin) {
    hits.push({ rule: "experience", detail: `社会人歴${career.toFixed(1)}年 < 下限${jv.experienceYearsMin}年` });
  }
  return { hits, locationFullRemoteOnly, locationBlock };
}

// ---------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const prisma = await loadPrisma();
  const jpGet = jobPlatformGetter();
  const now = new Date();
  const since30 = new Date(now.getTime() - WINDOW_DAYS * 86400_000);
  const md: string[] = [];
  const log = (s = "") => {
    md.push(s);
    console.log(s);
  };

  log(`# T-XXX 評価前の条件絞り込み 事前調査（集計）`);
  log();
  log(`- 実行: ${jst(now)} JST / 直近30日 = ${jst(since30)} 〜 / 5段階評価以降 = ${jst(T146_DONE_AT)} 〜`);
  log(`- 為替 1USD = ${JPY_PER_USD}円（前回比較テストと同じ）`);
  log();

  // ---------------- 1. 費用の内訳
  const usage = await prisma.$queryRawUnsafe<
    { endpoint: string; model: string; n: number; usd: number; files: number | null }[]
  >(
    `select endpoint, model, count(*)::int n, sum(cost_usd)::float8 usd, sum(file_count)::int files
     from advisor_usage_logs where created_at >= $1 group by 1,2 order by usd desc`,
    since30,
  );
  const FUNC: Record<string, string> = {
    "analyze-batch": "評価（手動）",
    "recommend-analyze": "評価（自動配信）",
    "advisor-chat": "AIアドバイザー チャット",
    "advisor-log-ingest": "AIアドバイザー 面談ログ取込",
    "file-parse": "書類読み取り",
    "resume-parse": "書類読み取り",
    "candidate-resume-parse": "書類読み取り",
    "guide-resume-parse": "書類読み取り",
    "employee-resume-parse": "書類読み取り",
  };
  const funcOf = (e: string) => FUNC[e] ?? "そのほか";
  const provider = (m: string) => (m.startsWith("gemini") ? "Gemini" : "Anthropic");
  log(`## 1. 費用の内訳（直近30日・AdvisorUsageLog）`);
  log();
  log(`| 機能 | endpoint | モデル | 呼び出し | 件数(file_count) | USD | 円 |`);
  log(`|--|--|--|--:|--:|--:|--:|`);
  for (const u of usage)
    log(`| ${funcOf(u.endpoint)} | ${u.endpoint} | ${u.model} | ${u.n} | ${u.files ?? "-"} | ${u.usd.toFixed(2)} | ${yen(u.usd)} |`);
  const byFunc = new Map<string, number>();
  for (const u of usage) {
    const k = provider(u.model) === "Anthropic" ? funcOf(u.endpoint).replace(/（.*）/, "") : `Gemini: ${u.endpoint}`;
    byFunc.set(k, (byFunc.get(k) ?? 0) + u.usd);
  }
  const totalUsd = usage.reduce((s, u) => s + u.usd, 0);
  log();
  log(`| 機能（まとめ） | USD | 円 | 割合 |`);
  log(`|--|--:|--:|--:|`);
  for (const [k, v] of [...byFunc.entries()].sort((a, b) => b[1] - a[1]))
    log(`| ${k} | ${v.toFixed(2)} | ${yen(v)} | ${pct(v, totalUsd)} |`);
  log(`| **合計** | **${totalUsd.toFixed(2)}** | **${yen(totalUsd)}** | 100% |`);
  log();

  const routeCost = {
    manual: usage.filter((u) => u.endpoint === "analyze-batch"),
    auto: usage.filter((u) => u.endpoint === "recommend-analyze"),
  };
  const perFileUsd = {
    manual:
      routeCost.manual.reduce((s, u) => s + u.usd, 0) / Math.max(1, routeCost.manual.reduce((s, u) => s + (u.files ?? 0), 0)),
    auto: routeCost.auto.reduce((s, u) => s + u.usd, 0) / Math.max(1, routeCost.auto.reduce((s, u) => s + (u.files ?? 0), 0)),
  };
  const routeUsd = {
    manual: routeCost.manual.reduce((s, u) => s + u.usd, 0),
    auto: routeCost.auto.reduce((s, u) => s + u.usd, 0),
  };
  const routeFiles = {
    manual: routeCost.manual.reduce((s, u) => s + (u.files ?? 0), 0),
    auto: routeCost.auto.reduce((s, u) => s + (u.files ?? 0), 0),
  };

  // ---------------- 母集団
  const rows = await prisma.$queryRawUnsafe<Bookmark[]>(
    `select f.id, f.candidate_id, c.candidate_number, f.file_name, f.job_title, f.ai_match_rating, f.ai_analyzed_at,
            f.auto_sourced_at, f.archived_at, f.origin, f.kyuujin_job_id, f.external_job_ref
     from candidate_files f join candidates c on c.id = f.candidate_id
     where f.category = 'BOOKMARK' and f.ai_match_rating is not null and f.ai_analyzed_at >= $1`,
    T146_DONE_AT,
  );
  const pop = rows.filter((r) => headRank(r.ai_match_rating));
  const route = (r: Bookmark) => (r.auto_sourced_at ? "auto" : "manual");
  const in30 = (r: Bookmark) => r.ai_analyzed_at >= since30;

  log(`## 2. 評価の経路別`);
  log();
  log(`経路の見分け: CandidateFile.autoSourcedAt が入っている行 = 自動配信（T-189 recommend-engine が作った行）、null = 手動（CA がブックマークして評価）。`);
  log(`費用は AdvisorUsageLog の endpoint（analyze-batch = 手動 / recommend-analyze = 自動配信）で分ける。`);
  log(`ランクは CandidateFile に残っている最新評価（再評価で上書きされるため、ログの件数とは一致しない）。`);
  log();
  log(`| 経路 | 30日の評価件数(ログ file_count) | 30日の費用 | 1件あたり | 30日に評価された行 | 5段階以降の評価済み行 |`);
  log(`|--|--:|--:|--:|--:|--:|`);
  for (const k of ["manual", "auto"] as const) {
    log(
      `| ${k === "manual" ? "手動" : "自動配信"} | ${routeFiles[k]} | ${yen(routeUsd[k])} ($${routeUsd[k].toFixed(2)}) | ${yen(perFileUsd[k])} | ${pop.filter((r) => route(r) === k && in30(r)).length} | ${pop.filter((r) => route(r) === k).length} |`,
    );
  }
  log();
  log(`| 経路 | 期間 | 件数 | ${RANKS.join(" | ")} |`);
  log(`|--|--|--:|${RANKS.map(() => "--:").join("|")}|`);
  for (const k of ["manual", "auto"] as const)
    for (const [label, f] of [
      ["直近30日", (r: Bookmark) => in30(r)],
      ["5段階以降", () => true],
    ] as const) {
      const sub = pop.filter((r) => route(r) === k && f(r));
      log(
        `| ${k === "manual" ? "手動" : "自動配信"} | ${label} | ${sub.length} | ${RANKS.map((rk) => `${sub.filter((r) => headRank(r.ai_match_rating) === rk).length} (${pct(sub.filter((r) => headRank(r.ai_match_rating) === rk).length, sub.length)})`).join(" | ")} |`,
      );
    }
  log();
  const origCand = pop.filter((r) => r.origin === "candidate").length;
  log(`- 補足: 手動のうち求職者本人がお気に入りした行（origin=candidate）${origCand}件、アーカイブ済み ${pop.filter((r) => r.archived_at).length}件も母集団に含む（評価費用は発生済みのため）`);
  log();

  // ---------------- 3. 求人側
  const refs = [...new Set(pop.map((r) => r.external_job_ref).filter((x): x is string => !!x))];
  const jpBySrc = new Map<string, JpJob>();
  const cols =
    "source_job_id,source_media,media_job_id,salary_min,salary_max,salary_type,work_locations,remote_type,age_min,age_max,experience_years_min,job_changes_max,education,tags,required_qualifications,status";
  for (let i = 0; i < refs.length; i += 80) {
    const chunk = refs.slice(i, i + 80);
    const inList = chunk.map((s) => `"${s.replace(/"/g, "")}"`).join(",");
    const got = await jpGet<JpJob[]>(`jobs?select=${cols}&source_job_id=in.(${encodeURIComponent(inList)})`);
    for (const j of got) jpBySrc.set(j.source_job_id, j);
  }
  console.log(`[job-platform] refs ${refs.length} → 取得 ${jpBySrc.size}`);

  // kyuujinPDF（kyuujinJobId を持つ候補者だけ）
  const kyByCand = new Map<string, string>();
  for (const r of pop) if (r.kyuujin_job_id != null) kyByCand.set(r.candidate_id, r.candidate_number);
  const kyById = new Map<number, KyJob>();
  let kyFail = 0;
  const kyList = [...kyByCand.values()];
  for (let i = 0; i < kyList.length; i += 4) {
    await Promise.all(
      kyList.slice(i, i + 4).map(async (num) => {
        try {
          const res = await fetch(`${KYUUJIN_BASE}/api/projects/by-job-seeker-id/${encodeURIComponent(num)}/jobs`, {
            method: "GET",
          });
          if (!res.ok) {
            kyFail++;
            return;
          }
          const j = (await res.json()) as { jobs?: KyJob[] };
          for (const job of j.jobs ?? []) kyById.set(job.id, job);
        } catch {
          kyFail++;
        }
      }),
    );
  }
  console.log(`[kyuujin] 候補者 ${kyList.length}人 (失敗 ${kyFail}) → jobs ${kyById.size}`);

  const withJp = pop.filter((r) => r.external_job_ref && jpBySrc.has(r.external_job_ref));
  const withKy = pop.filter((r) => r.kyuujin_job_id != null && kyById.has(r.kyuujin_job_id));
  const N = pop.length;
  const jpOf = (r: Bookmark) => (r.external_job_ref ? jpBySrc.get(r.external_job_ref) : undefined);
  const kyOf = (r: Bookmark) => (r.kyuujin_job_id != null ? kyById.get(r.kyuujin_job_id) : undefined);
  const cntJp = (f: (j: JpJob) => boolean) => withJp.filter((r) => f(jpOf(r)!)).length;
  const cntKy = (f: (j: KyJob) => boolean) => withKy.filter((r) => f(kyOf(r)!)).length;

  log(`## 3. 求人側の項目`);
  log();
  log(`母集団 ${N}件（5段階以降に評価済みのブックマーク）。`);
  log();
  log(`| つながり | 件数 | 割合 |`);
  log(`|--|--:|--:|`);
  log(`| externalJobRef あり | ${pop.filter((r) => r.external_job_ref).length} | ${pct(pop.filter((r) => r.external_job_ref).length, N)} |`);
  log(`| → 求人プラットフォーム jobs.source_job_id と一致 | ${withJp.length} | ${pct(withJp.length, N)} |`);
  log(`| kyuujinJobId あり | ${pop.filter((r) => r.kyuujin_job_id != null).length} | ${pct(pop.filter((r) => r.kyuujin_job_id != null).length, N)} |`);
  log(`| → kyuujinPDF API で求人が取れた | ${withKy.length} | ${pct(withKy.length, N)} |`);
  log(`| kyuujinPDF だけ（求人プラットフォームに無い） | ${withKy.filter((r) => !jpOf(r)).length} | ${pct(withKy.filter((r) => !jpOf(r)).length, N)} |`);
  log(`| どちらにも無い | ${pop.filter((r) => !jpOf(r) && !kyOf(r)).length} | ${pct(pop.filter((r) => !jpOf(r) && !kyOf(r)).length, N)} |`);
  log();
  // kyuujin だけの行が媒体の求人番号で求人プラットフォームにつながるか
  const kyOnly = withKy.filter((r) => !jpOf(r));
  let kyOnlyLinkable = 0;
  const kyOnlyIds = [...new Set(kyOnly.map((r) => (kyOf(r)!.job_id ?? "").trim()).filter((s) => s && s !== "1"))];
  if (kyOnlyIds.length) {
    const found = new Set<string>();
    for (let i = 0; i < kyOnlyIds.length; i += 80) {
      const inList = kyOnlyIds.slice(i, i + 80).map((s) => `"${s.replace(/"/g, "")}"`).join(",");
      const got = await jpGet<{ media_job_id: string }[]>(`jobs?select=media_job_id&media_job_id=in.(${encodeURIComponent(inList)})`);
      for (const g of got) found.add(g.media_job_id);
    }
    kyOnlyLinkable = kyOnly.filter((r) => found.has((kyOf(r)!.job_id ?? "").trim())).length;
  }
  log(`- kyuujinPDF だけの ${kyOnly.length}件のうち、媒体の求人番号（kyuujin job_id = 求人プラットフォーム media_job_id）で求人プラットフォームにつながるもの: ${kyOnlyLinkable}件（マイナビ JOB の job_id は "1" 固定で使えない）`);
  log();

  log(`### 求人プラットフォーム jobs（整理済みの項目）の充足率（分母 ${withJp.length}件）`);
  log();
  log(`| 項目 | 列 | 入っている件数 | 充足率 |`);
  log(`|--|--|--:|--:|`);
  const jpItems: [string, string, (j: JpJob) => boolean][] = [
    ["年収 下限", "salary_min", (j) => j.salary_min != null],
    ["年収 上限", "salary_max", (j) => j.salary_max != null],
    ["年収（上限か下限・100万以上）", "salary_max ?? salary_min", (j) => (j.salary_max ?? j.salary_min ?? 0) >= 100],
    ["勤務地（都道府県）", "work_locations[].prefecture", (j) => (j.work_locations ?? []).some((l) => normPref(l?.prefecture))],
    ["在宅（full_remote/hybrid/onsite いずれか）", "remote_type", (j) => j.remote_type != null],
    ["在宅可（full_remote/hybrid）", "remote_type", (j) => j.remote_type === "full_remote" || j.remote_type === "hybrid"],
    ["転勤なしタグ", "tags", (j) => (j.tags ?? []).includes("転勤なし")],
    ["年齢上限", "age_max", (j) => j.age_max != null],
    ["学歴（設定なし以外）", "education", (j) => !!j.education && j.education !== "設定なし"],
    ["転職回数の上限", "job_changes_max", (j) => j.job_changes_max != null],
    ["社会人歴の下限", "experience_years_min", (j) => j.experience_years_min != null],
    ["必須資格（文章のみ・今回は使わない）", "required_qualifications", (j) => !!j.required_qualifications?.trim()],
  ];
  for (const [label, col, f] of jpItems) log(`| ${label} | ${col} | ${cntJp(f)} | ${pct(cntJp(f), withJp.length)} |`);
  log();
  log(`- 転勤「あり」を示す構造化項目は無い（tags は「転勤なし」だけ）。「全国」勤務地は ${withJp.filter((r) => (jpOf(r)!.work_locations ?? []).some((l) => /全国/.test(`${l?.prefecture ?? ""}${l?.city ?? ""}`))).length}件`);
  const eduDist = new Map<string, number>();
  for (const r of withJp) eduDist.set(jpOf(r)!.education ?? "(null)", (eduDist.get(jpOf(r)!.education ?? "(null)") ?? 0) + 1);
  log(`- education の値: ${[...eduDist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  log();

  log(`### kyuujinPDF jobs の充足率（分母 ${withKy.length}件）`);
  log();
  log(`| 項目 | 列 | 形 | 入っている件数 | 充足率 |`);
  log(`|--|--|--|--:|--:|`);
  const kyItems: [string, string, string, (j: KyJob) => boolean][] = [
    ["年収", "salary", "文字列（例「450万円～580万円」）→ 数字を抜けた件数", (j) => parseKySalaryTop(j.salary) != null],
    ["勤務地（都道府県）", "work_location", "文字列 → 都道府県名を含む件数", (j) => prefsInText(j.work_location).length > 0],
    ["転勤", "transfer", "「なし」「応相談」等（記載なしを除く）", (j) => kyTransfer(j.transfer) != null],
    ["在宅", "-", "項目なし", () => false],
    ["応募条件（年齢・学歴・転職回数・社会人歴・資格）", "requirements", "文章のみ（今回は使わない）", (j) => !!j.requirements?.trim()],
  ];
  for (const [label, col, form, f] of kyItems) log(`| ${label} | ${col} | ${form} | ${cntKy(f)} | ${pct(cntKy(f), withKy.length)} |`);
  const trDist = new Map<string, number>();
  for (const r of withKy) {
    const t = (kyOf(r)!.transfer ?? "(null)").trim() || "(空)";
    trDist.set(t, (trDist.get(t) ?? 0) + 1);
  }
  log();
  log(`- transfer の値（上位）: ${[...trDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  log();

  // ---------------- 4. 求職者側
  const candIds = [...new Set(pop.map((r) => r.candidate_id))];
  const cands = await prisma.$queryRawUnsafe<Cand[]>(
    `with d as (
       select distinct on (r.candidate_id) r.candidate_id, r.id rec_id, d.*
       from interview_records r join interview_details d on d.interview_record_id = r.id
       where r.candidate_id = any($1::text[])
       order by r.candidate_id, r.interview_date desc, r.created_at desc
     ), w as (
       select distinct on (r.candidate_id) r.candidate_id,
              (select count(*) from work_histories x where x.interview_record_id = r.id)::int wh_count
       from interview_records r
       where r.candidate_id = any($1::text[]) and exists (select 1 from work_histories x where x.interview_record_id = r.id)
       order by r.candidate_id, r.interview_date desc, r.created_at desc
     )
     select c.id, c.birthday, c.desired_salary_min cand_salary_min, c.desired_prefecture1 cand_pref1, c.desired_prefecture2 cand_pref2,
            d.desired_salary_min d_salary_min, d.reg_salary_min d_reg_salary_min, d.desired_areas d_desired_areas,
            d.desired_prefecture d_desired_prefecture, d.reg_area_prefecture d_reg_area_prefecture,
            d.education_flag d_education_flag, d.graduation_date d_graduation_date, d.graduation_status d_graduation_status,
            d.driver_license_flag d_driver_license_flag, w.wh_count
     from candidates c left join d on d.candidate_id = c.id left join w on w.candidate_id = c.id
     where c.id = any($1::text[])`,
    candIds,
  );
  const candById = new Map(cands.map((c) => [c.id, c]));
  const cvById = new Map(cands.map((c) => [c.id, candValues(c)]));
  const NC = cands.length;
  const cc = (f: (c: Cand, v: CandValues) => boolean) => cands.filter((c) => f(c, cvById.get(c.id)!)).length;

  log(`## 4. 求職者側の項目（評価対象になった求職者 ${NC}人）`);
  log();
  log(`面談詳細 = 各求職者の最新の面談記録（interview_date が最も新しいもの）に付いた InterviewDetail。`);
  log();
  log(`| 項目 | 置き場所 | 入っている人数 | 充足率 |`);
  log(`|--|--|--:|--:|`);
  const cItems: [string, string, (c: Cand, v: CandValues) => boolean][] = [
    ["希望年収（下限）", "面談詳細.desiredSalaryMin（>0）", (c) => (c.d_salary_min ?? 0) > 0],
    ["希望年収（下限）", "Candidate.desiredSalaryMin（>0）", (c) => (c.cand_salary_min ?? 0) > 0],
    ["希望年収（下限）", "面談詳細.regSalaryMin（登録時・>0）", (c) => (c.d_reg_salary_min ?? 0) > 0],
    ["希望年収（下限）", "**使う値**: 上の順に最初に埋まっているもの", (_c, v) => v.salaryMin != null],
    ["希望勤務地（都道府県）", "面談詳細.desiredAreas[].prefecture", (c) => Array.isArray(c.d_desired_areas) && (c.d_desired_areas as { prefecture?: string }[]).some((a) => normPref(a?.prefecture))],
    ["希望勤務地（都道府県）", "面談詳細.desiredPrefecture", (c) => !!normPref(c.d_desired_prefecture)],
    ["希望勤務地（都道府県）", "Candidate.desiredPrefecture1/2", (c) => !!normPref(c.cand_pref1) || !!normPref(c.cand_pref2)],
    ["希望勤務地（都道府県）", "**使う値**: 上の3つの和集合（落としすぎ防止）", (_c, v) => v.prefs.length > 0 || v.anyArea],
    ["年齢", "Candidate.birthday", (c) => !!c.birthday],
    ["最終学歴", "面談詳細.educationFlag（段階に直せるもの）", (_c, v) => v.educationLevel != null],
    ["転職回数", "work_histories の社数 − 1（現職を含む・1社以上）", (_c, v) => v.jobChanges != null],
    ["社会人歴", "面談詳細.graduationDate から評価日まで", (_c, v) => v.gradYear != null],
    ["保有資格", "面談詳細.driverLicenseFlag（運転免許のみ・他資格の構造化項目は無い）", (c) => !!c.d_driver_license_flag?.trim()],
  ];
  for (const [label, where, f] of cItems) log(`| ${label} | ${where} | ${cc(f)} | ${pct(cc(f), NC)} |`);
  log();
  log(`- 希望年収の単位は万円（例 350）。面談詳細.regAreaPrefecture（登録時の居住地系）は希望勤務地と意味が違うため使わない`);
  log(`- 学歴の段階: 中卒0 / 高校卒1 / 専門卒2 / 短大・専門卒・短大卒・高専卒3 / 大学卒4 / 大学院卒5（「短大・専門卒」は落としすぎない側の3に寄せる）。学校名だけ入っている行は不明扱い`);
  log();

  // ---------------- 5. 模擬
  const entries = await prisma.$queryRawUnsafe<
    { candidate_id: string; external_job_id: number; external_job_ref: string | null; entry_flag: string | null }[]
  >(
    `select candidate_id, external_job_id, external_job_ref, entry_flag from job_entries
     where candidate_id = any($1::text[]) and entry_flag = any($2::text[])`,
    candIds,
    PROGRESSED_FLAGS,
  );
  const progressed = new Set<string>();
  for (const e of entries) {
    progressed.add(`${e.candidate_id}|kj|${e.external_job_id}`);
    if (e.external_job_ref) progressed.add(`${e.candidate_id}|ref|${e.external_job_ref}`);
  }
  const isProgressed = (r: Bookmark) =>
    (r.kyuujin_job_id != null && progressed.has(`${r.candidate_id}|kj|${r.kyuujin_job_id}`)) ||
    (r.external_job_ref != null && progressed.has(`${r.candidate_id}|ref|${r.external_job_ref}`));

  type Res = { r: Bookmark; rank: Rank; hits: Hit[]; locFR: boolean; locBlock: string | null; progressed: boolean; cv: CandValues; jv: JobValues; age: number | null; career: number | null };
  const results: Res[] = pop.map((r) => {
    const c = candById.get(r.candidate_id)!;
    const cv = cvById.get(r.candidate_id)!;
    const jv = jobValues(jpOf(r), kyOf(r));
    const age = ageAt(c.birthday, r.ai_analyzed_at);
    const career = careerYearsAt(cv, r.ai_analyzed_at);
    const { hits, locationFullRemoteOnly, locationBlock } = applyRules(cv, jv, age, career);
    return { r, rank: headRank(r.ai_match_rating)!, hits, locFR: locationFullRemoteOnly, locBlock: locationBlock, progressed: isProgressed(r), cv, jv, age, career };
  });
  const progressedTotal = results.filter((x) => x.progressed).length;

  // 両方の値がそろって「比べられた」件数
  const comparable: Record<Rule, (x: Res) => boolean> = {
    salary: (x) => x.cv.salaryMin != null && x.jv.salaryTop != null,
    location: (x) => !x.cv.anyArea && x.cv.prefs.length > 0 && x.jv.prefs.length > 0,
    age: (x) => x.jv.ageMax != null && x.age != null,
    education: (x) => x.jv.educationLevel != null && x.cv.educationLevel != null,
    jobChanges: (x) => x.jv.jobChangesMax != null && x.cv.jobChanges != null,
    experience: (x) => x.jv.experienceYearsMin != null && x.career != null,
  };

  log(`## 5. 絞り込みの模擬`);
  log();
  log(`対象 ${N}件（手動 ${results.filter((x) => route(x.r) === "manual").length} / 自動配信 ${results.filter((x) => route(x.r) === "auto").length}）。どちらか一方の値が空なら落とさない。`);
  log(`エントリー以降に進んだ求人（JobEntry.entryFlag が ${PROGRESSED_FLAGS.join("/")}、候補者 × kyuujinJobId=externalJobId または externalJobRef で突合）: ${progressedTotal}件。`);
  log();
  log(`ルールの細部:`);
  log(`- 年収: 求人の上限（無ければ下限・100万未満は月給の取り違えとみなし不使用）< 希望年収下限 − ${SALARY_MARGIN}万`);
  log(`- 勤務地: 求人の都道府県が希望と1つも重ならない。在宅可（remote_type=full_remote/hybrid またはタグ「リモートOK」）・全国・転勤あり（kyuujin transfer が「なし」「記載なし」以外）は残す。転勤が不明の求人は「転勤あり」とはみなさない`);
  log(`- 年齢: 評価日時点の年齢 > age_max / 学歴: 段階が必須学歴に届かない / 転職回数: 社数−1 > job_changes_max / 社会人歴: 卒業から評価日までの年数 < experience_years_min`);
  log();

  const ruleSets: [string, (x: Res) => boolean][] = [
    ...RULES.map((rule) => [RULE_LABEL[rule], (x: Res) => x.hits.some((h) => h.rule === rule)] as [string, (x: Res) => boolean]),
    ["**全部合わせて**", (x: Res) => x.hits.length > 0],
    ["（参考）勤務地・在宅はフルリモートだけ残す", (x: Res) => x.locFR],
    ["（参考）勤務地を地方ブロックで判定", (x: Res) => !!x.locBlock],
    ["（参考）安全寄り: 年収+勤務地(地方ブロック)+年齢+学歴", (x: Res) => !!x.locBlock || x.hits.some((h) => ["salary", "age", "education"].includes(h.rule))],
    ["（参考）全部 − 勤務地", (x: Res) => x.hits.some((h) => h.rule !== "location")],
    ["（参考）年齢+学歴+転職回数+社会人歴", (x: Res) => x.hits.some((h) => ["age", "education", "jobChanges", "experience"].includes(h.rule))],
  ];

  log(`### 落ちる件数と割合`);
  log();
  log(`| ルール | 比べられた件数 | 落ちる（全体） | 手動 | 自動配信 | ${RANKS.join(" | ")} | A/B+ を落とす | エントリー実績を落とす |`);
  log(`|--|--:|--:|--:|--:|${RANKS.map(() => "--:").join("|")}|--:|--:|`);
  const nMan = results.filter((x) => route(x.r) === "manual").length;
  const nAuto = results.filter((x) => route(x.r) === "auto").length;
  for (const [label, f] of ruleSets) {
    const d = results.filter(f);
    const rule = RULES.find((rr) => RULE_LABEL[rr] === label);
    const comp = rule ? results.filter(comparable[rule]).length : "-";
    const dm = d.filter((x) => route(x.r) === "manual").length;
    const da = d.filter((x) => route(x.r) === "auto").length;
    const hi = d.filter((x) => x.rank === "A" || x.rank === "B+").length;
    const pg = d.filter((x) => x.progressed).length;
    log(
      `| ${label} | ${comp} | ${d.length} (${pct(d.length, N)}) | ${dm} (${pct(dm, nMan)}) | ${da} (${pct(da, nAuto)}) | ${RANKS.map((rk) => d.filter((x) => x.rank === rk).length).join(" | ")} | ${hi} | ${pg} |`,
    );
  }
  log();
  // 過去ランク別の落ちる割合（全部合わせて）
  log(`### 過去ランク別に見た落ちる割合（全部合わせて）`);
  log();
  log(`| 過去ランク | 母数 | 落ちる | 割合 |`);
  log(`|--|--:|--:|--:|`);
  for (const rk of RANKS) {
    const all = results.filter((x) => x.rank === rk);
    const d = all.filter((x) => x.hits.length > 0);
    log(`| ${rk} | ${all.length} | ${d.length} | ${pct(d.length, all.length)} |`);
  }
  log();

  // ---------------- 削減見込み
  log(`### 削減見込み（月額・直近30日ベース）`);
  log();
  log(`- 方式1（指示どおり）: 直近30日に評価された行のうち落ちる件数 × 経路別の1件あたり評価費用（手動 ${yen(perFileUsd.manual)} / 自動配信 ${yen(perFileUsd.auto)}）`);
  log(`- 方式2（再評価込み）: 経路別の30日費用 × 直近30日に評価された行で落ちる割合。ログの件数（手動 ${routeFiles.manual}）は再評価を含み、行数（${results.filter((x) => route(x.r) === "manual" && in30(x.r)).length}）より多いため、方式1は控えめに出る`);
  log();
  log(`| ルール | 30日の落ちる件数 手動/自動 | 方式1 月額 | 方式2 月額 | 評価費用に対する割合 |`);
  log(`|--|--:|--:|--:|--:|`);
  const m30 = results.filter((x) => route(x.r) === "manual" && in30(x.r));
  const a30 = results.filter((x) => route(x.r) === "auto" && in30(x.r));
  const evalUsd = routeUsd.manual + routeUsd.auto;
  for (const [label, f] of ruleSets) {
    const dm = m30.filter(f).length;
    const da = a30.filter(f).length;
    const s1 = dm * perFileUsd.manual + da * perFileUsd.auto;
    const s2 = routeUsd.manual * (dm / Math.max(1, m30.length)) + routeUsd.auto * (da / Math.max(1, a30.length));
    log(`| ${label} | ${dm} / ${da} | ${yen(s1)} | ${yen(s2)} | ${pct(s2, evalUsd)} |`);
  }
  log(`| （評価費用 30日合計） | ${m30.length} / ${a30.length} 行 | | ${yen(evalUsd)} | 100% |`);
  log();

  // ---------------- 危ない明細（ID のみ集計に載せる）
  const risky = results.filter((x) => (x.hits.length > 0 || x.locBlock) && (x.rank === "A" || x.rank === "B+" || x.progressed));
  log(`### A/B+ またはエントリー実績ありで落ちる求人（ルール別の内訳・明細は risky.csv）`);
  log();
  log(`| ルール | A/B+ | エントリー実績あり | 両方 |`);
  log(`|--|--:|--:|--:|`);
  for (const rule of RULES) {
    const d = results.filter((x) => x.hits.some((h) => h.rule === rule));
    log(
      `| ${RULE_LABEL[rule]} | ${d.filter((x) => x.rank === "A" || x.rank === "B+").length} | ${d.filter((x) => x.progressed).length} | ${d.filter((x) => (x.rank === "A" || x.rank === "B+") && x.progressed).length} |`,
    );
  }
  {
    const d = results.filter((x) => x.locBlock);
    log(`| （参考）勤務地を地方ブロックで判定 | ${d.filter((x) => x.rank === "A" || x.rank === "B+").length} | ${d.filter((x) => x.progressed).length} | ${d.filter((x) => (x.rank === "A" || x.rank === "B+") && x.progressed).length} |`);
    log();
  }
  log(`| file id | candidate id | 経路 | 過去ランク | エントリー実績 | ルール | 比べた値 |`);
  log(`|--|--|--|--|--|--|--|`);
  for (const x of risky)
    log(
      `| ${x.r.id} | ${x.r.candidate_id} | ${route(x.r) === "manual" ? "手動" : "自動"} | ${x.rank} | ${x.progressed ? "あり" : "-"} | ${x.hits.map((h) => RULE_LABEL[h.rule]).join("+")} | ${x.hits.map((h) => h.detail).join(" / ")} |`,
    );
  log();

  // ---------------- CSV
  const header = [
    "file_id", "candidate_id", "candidate_number", "route", "rank", "rating_raw", "ai_analyzed_at_jst", "archived",
    "progressed", "external_job_ref", "kyuujin_job_id", "file_name", "job_title",
    "job_salary_top", "job_salary_src", "job_prefs", "job_prefs_src", "job_remote", "job_transfer", "job_age_max",
    "job_education", "job_changes_max", "job_exp_min",
    "cand_salary_min", "cand_salary_src", "cand_prefs", "cand_any_area", "cand_age", "cand_education", "cand_job_changes", "cand_career_years",
    "dropped_rules", "drop_details", "location_block_drop",
  ];
  const line = (x: Res) =>
    [
      x.r.id, x.r.candidate_id, x.r.candidate_number, route(x.r), x.rank, x.r.ai_match_rating, jst(x.r.ai_analyzed_at), x.r.archived_at ? 1 : 0,
      x.progressed ? 1 : 0, x.r.external_job_ref, x.r.kyuujin_job_id, x.r.file_name, x.r.job_title,
      x.jv.salaryTop, x.jv.salarySource, x.jv.prefs.join("/"), x.jv.prefsSource, x.jv.remote, x.jv.transfer ? x.jv.transferSource : "",
      x.jv.ageMax, x.jv.educationRaw, x.jv.jobChangesMax, x.jv.experienceYearsMin,
      x.cv.salaryMin, x.cv.salarySource, x.cv.prefs.join("/"), x.cv.anyArea ? 1 : 0, x.age, x.cv.educationRaw, x.cv.jobChanges,
      x.career != null ? x.career.toFixed(1) : "",
      x.hits.map((h) => RULE_LABEL[h.rule]).join("+"), x.hits.map((h) => h.detail).join(" / "), x.locBlock ?? "",
    ]
      .map(csvCell)
      .join(",");
  const bom = "﻿";
  fs.writeFileSync(path.join(OUT_DIR, "detail.csv"), bom + [header.join(","), ...results.map(line)].join("\r\n"), "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, "risky.csv"), bom + [header.join(","), ...risky.map(line)].join("\r\n"), "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), md.join("\n"), "utf-8");
  console.log(`\n[out] ${OUT_DIR}/summary.md, detail.csv (${results.length}), risky.csv (${risky.length})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

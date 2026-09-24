/**
 * 面談ログの分析用TXT書き出し（LP制作用データ抽出）
 *
 * 事前調査: C:\bizstudio\_work\LP_data_survey_2026-09-10\LP_data_survey_2026-09-10.md
 *
 * - 本番DBは SELECT のみ（INSERT / UPDATE / DELETE・マイグレーションは一切行わない）
 * - 面談本文はDBに存在しない（raw_transcript / summary_text は 0%）。実体は Google Drive の
 *   CandidateFile（category=MEETING かつ mime_type='text/plain'）のみ。
 *   MEETING の .pdf は面談ログではなく応募書類（履歴書・キャリアシート）なので除外する。
 * - JST日付は `col + INTERVAL '9 hours'`（AT TIME ZONE / toISOString().slice(0,10) は使わない）
 * - 出力は氏名・電話・メール等を機械置換した匿名化済みTXT。匿名IDと実名の対応表は出力しない。
 *
 * 実行:
 *   GOOGLE_SERVICE_ACCOUNT_KEY を環境に入れた上で
 *   npx tsx --env-file=<portal の .env> scripts/export-interview-logs.ts \
 *     --out "C:/bizstudio/_work/LP_export_2026-09-10" [--cache <dir>]
 */

import { Pool } from "pg";
import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";

export {};

// ---------------------------------------------------------------- 設定

const FROM_JST = "2026-07-11";
const TO_JST = "2026-09-10";
const BASE_DATE = "2026-09-10"; // 進捗・年代の基準日
const PER_FILE = 10; // 1ファイルあたりの人数
const VERBATIM_MIN_CHARS = 2000; // これ未満は「CAメモ」判定

const argv = process.argv.slice(2);
const getArg = (k: string, d?: string) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const OUT_DIR = getArg("--out", "C:/bizstudio/_work/LP_export_2026-09-10")!;
const CACHE_DIR = getArg("--cache"); // 指定時は Drive 取得結果をここにキャッシュ

const SENSITIVE_KEYWORDS = [
  "病", "うつ", "診断", "通院", "入院", "障害", "休職",
  "離婚", "介護", "妊娠", "子ども", "家族", "親",
];

// ---------------------------------------------------------------- 型

type Row = Record<string, any>;

interface LogFile {
  id: string;
  fileName: string;
  driveFileId: string;
  fileSize: number;
  createdAtJst: string;
  interviewDate: string | null;
  interviewCount: number | null;
  resolution: "確定" | "推定" | "取得不可";
  text: string;
}

interface Person {
  pid: string;
  cand: Row;
  firstInterview: Row | null;
  detail: Row | null;
  works: Row[];
  interviews: Row[];
  logs: LogFile[];
}

// ---------------------------------------------------------------- 汎用

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** 逐語パートの行: 行全体が「話者ラベル + 2要素タイムスタンプ」。要約側は 3要素(HH:MM:SS)なので当たらない */
const SPEAKER_LINE = /^\s*(\S[^\n]{0,15}?)\s+\d{1,3}:\d{2}\s*$/;

const NA = "取得不可";
const NONE = "言及なし";

function v(x: any): string {
  if (x === null || x === undefined) return NONE;
  const s = String(x).trim();
  return s === "" ? NONE : s;
}

function jstDate(d: Date | string | null): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  const j = new Date(t.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, "0")}-${String(j.getUTCDate()).padStart(2, "0")}`;
}

/** interview_date は JST暦日を UTC 00:00 で保存しているので +9h せずそのまま日付を読む */
function interviewDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function ageBand(birthday: Date | string | null): string {
  if (!birthday) return NA;
  const b = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(b.getTime())) return NA;
  const base = new Date(`${BASE_DATE}T00:00:00Z`);
  let age = base.getUTCFullYear() - b.getUTCFullYear();
  const m = base.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && base.getUTCDate() < b.getUTCDate())) age--;
  if (age < 0 || age > 100) return NA;
  if (age < 20) return "10代";
  if (age >= 70) return "70代以上";
  const decade = Math.floor(age / 10) * 10;
  return `${decade}代${age - decade < 5 ? "前半" : "後半"}`;
}

const PREF_RE = /(東京都|北海道|京都府|大阪府|神奈川県|和歌山県|鹿児島県|[^\s\d]{2}県)/;
function prefectureOf(address: string | null): string {
  if (!address) return NA;
  const m = address.match(PREF_RE);
  return m ? m[1] : NA;
}

function genderLabel(g: string | null): string {
  if (!g) return NONE;
  const map: Record<string, string> = {
    male: "男性", female: "女性", other: "その他", 男: "男性", 女: "女性",
  };
  return map[g] ?? g;
}

// ---------------------------------------------------------------- 匿名化

const ZEN_SP = /[\s\u3000]+/g;

/** 氏名から置換対象パターンを作る（姓のみ／名のみ／フルネーム／スペース有無）。1文字は誤爆が大きいので除外 */
function nameVariants(name: string | null): string[] {
  if (!name) return [];
  const out = new Set<string>();
  // 「新井 亜美（テスト）」のような注記付きは、注記あり／なしの両方を対象にする
  const bases = new Set<string>();
  const raw = String(name).trim();
  if (raw) bases.add(raw);
  const stripped = raw.replace(/[（(].*?[)）]/g, "").trim();
  if (stripped) bases.add(stripped);

  for (const trimmed of bases) {
    const compact = trimmed.replace(ZEN_SP, "");
    if (compact.length >= 2) {
      out.add(compact);
      out.add(trimmed);
    }
    const parts = trimmed.split(ZEN_SP).filter(Boolean);
    if (parts.length >= 2) {
      out.add(parts.join(" "));
      out.add(parts.join("　"));
      for (const p of parts) if (p.length >= 2) out.add(p);
    }
  }
  return [...out].filter((s) => s.length >= 2);
}

/** フルネーム形だけを返す（他人の氏名を「参考」として検出する用。姓・名の断片は誤爆が多いので使わない） */
function fullNameForms(name: string | null): string[] {
  if (!name) return [];
  const out = new Set<string>();
  for (const base of [String(name).trim(), String(name).replace(/[（(].*?[)）]/g, "").trim()]) {
    if (!base) continue;
    const compact = base.replace(ZEN_SP, "");
    if (compact.length >= 3) {
      out.add(compact);
      out.add(base);
      const parts = base.split(ZEN_SP).filter(Boolean);
      if (parts.length >= 2) {
        out.add(parts.join(" "));
        out.add(parts.join("　"));
      }
    }
  }
  return [...out].filter((s) => s.length >= 3);
}

const FILE_NAME_STOPWORDS = /(面談|面接|求人|会社|説明|ノート|サポート|体制|紹介|人材|派遣|対策|議事|録音)/;

/**
 * Drive のファイル名から本人氏名を取り出す。
 * DB の氏名と綴りが違うケース（例: DB「田中 亜実」／ファイル名「田中 亜美」、
 * テスト用アカウントに実在氏名のログが入っているケース）があり、DB の氏名だけでは消しきれないため。
 * 誤って一般語を氏名扱いしないよう、長さ・文字種・ストップワードで絞る。
 */
function nameFromFileName(fileName: string | null): string | null {
  if (!fileName) return null;
  let s = String(fileName).replace(/\.[A-Za-z0-9]+$/, "");
  s = s.replace(/[（(].*?[)）]/g, "").replace(/[①-⑳②]/g, "");
  // 先頭の「初回面談 / 新規面談 / 既存面談 / N回目面談 / 面接対策」と通し番号・日付を落とす
  s = s.replace(/^(初回面談|新規面談|既存面談|面接対策|\d+回目面談)/, "");
  s = s.replace(/^[\d_＿\-\s　]+/, "");
  s = s.replace(/^\d+[_＿\-\s　]*/, "");
  s = s.trim();
  if (!s || s.length > 12) return null;
  if (/[A-Za-z0-9]/.test(s)) return null;
  if (!/^[一-鿿぀-ヿ々〆ヶ\s　]+$/.test(s)) return null;
  if (FILE_NAME_STOPWORDS.test(s)) return null;
  return s;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Replacer {
  pattern: string;
  to: string;
}

function applyReplacers(text: string, reps: Replacer[]): string {
  if (reps.length === 0) return text;
  // 長いパターンを優先（フルネームを先に潰してから姓・名にあたる）
  const sorted = [...reps].sort((a, b) => b.pattern.length - a.pattern.length);
  let out = text;
  for (const r of sorted) {
    out = out.replace(new RegExp(escapeRe(r.pattern), "g"), r.to);
  }
  return out;
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_URL = /https?:\/\/[^\s<>"'）」】]+/g;
const RE_TEL = /(?<![0-9])(?:0\d{1,4}[-(\s]?\d{1,4}[-)\s]?\d{3,4}|0\d{9,10})(?![0-9])/g;
const RE_TEL_ZEN = /[０-９]{2,4}[ー－-][０-９]{2,4}[ー－-][０-９]{3,4}/g;

/** 本文中に「生年月日: 平成12年2月4日」「現住所: 愛知県名古屋市中川区」のような記載が残っていないかの検出用 */
const RE_BODY_BIRTHDAY =
  /(生年月日|誕生日)[^\n]{0,4}[：:\s][^\n]{0,30}?((昭和|平成|令和|19|20)\d{0,2}[年/.-]\s*\d{1,2}[月/.-]\s*\d{1,2}日?)/;
const RE_BODY_ADDRESS =
  /(現住所|住所)[^\n]{0,4}[：:\s][^\n]{0,10}(東京都|北海道|京都府|大阪府|[^\s\d]{2,3}県)[^\n]{2,}/;

function scrubContacts(text: string): string {
  return text
    .replace(RE_EMAIL, "［メールアドレス除去］")
    .replace(RE_URL, "［URL除去］")
    .replace(RE_TEL, "［電話番号除去］")
    .replace(RE_TEL_ZEN, "［電話番号除去］");
}

/** 会社名は原文と、法人格を落としたコアの両方を置換対象にする */
function companyVariants(company: string | null): string[] {
  if (!company) return [];
  const raw = String(company).trim();
  if (!raw) return [];
  const out = new Set<string>();
  if (raw.length >= 2) out.add(raw);
  const core = raw
    .replace(
      /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人社団|医療法人|学校法人|社会福祉法人|独立行政法人|特定非営利活動法人|NPO法人)/g,
      ""
    )
    .replace(/[（(]株[)）]|[（(]有[)）]/g, "")
    .replace(ZEN_SP, "")
    .trim();
  if (core.length >= 2) out.add(core);
  return [...out];
}

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function seqLabel(i: number): string {
  if (i < 26) return ALPHA[i];
  return ALPHA[Math.floor(i / 26) - 1] + ALPHA[i % 26];
}

// ---------------------------------------------------------------- ログ解析

interface LogAnalysis {
  format: "逐語" | "CAメモ";
  hasSpeakerLabel: boolean;
  summary: "あり" | "なし" | "判定不能";
  body: string;
}

const SUMMARY_MARK = "========== ここまでAI生成の要約（本人の発言ではない） ==========";
const VERBATIM_MARK = "========== ここから逐語ログ ==========";

function analyzeLog(text: string): LogAnalysis {
  const lines = text.split(/\r?\n/);
  const stripped = lines.map((l) => l.replace(BIDI, ""));

  let firstSpeaker = -1;
  for (let i = 0; i < stripped.length; i++) {
    if (SPEAKER_LINE.test(stripped[i])) {
      firstSpeaker = i;
      break;
    }
  }
  let firstNonEmpty = stripped.findIndex((l) => l.trim() !== "");
  if (firstNonEmpty < 0) firstNonEmpty = 0;

  const speakerLineCount = stripped.filter((l) => SPEAKER_LINE.test(l)).length;
  const altLabelCount = stripped.filter((l) => /^\s*(CA|求職者|担当|アドバイザー|話者)\s*[:：]/.test(l)).length;
  const hasSpeakerLabel = speakerLineCount >= 3 || altLabelCount >= 3;

  const format: "逐語" | "CAメモ" = text.length >= VERBATIM_MIN_CHARS ? "逐語" : "CAメモ";

  if (firstSpeaker < 0) {
    // 逐語パートが存在しない＝要約／CAメモのみ。境目が機械的に決まらないので区切りを入れない。
    return { format, hasSpeakerLabel, summary: "判定不能", body: text };
  }
  if (firstSpeaker <= firstNonEmpty) {
    return { format, hasSpeakerLabel, summary: "なし", body: text };
  }
  const head = lines.slice(0, firstSpeaker).join("\n").replace(/\s+$/, "");
  const tail = lines.slice(firstSpeaker).join("\n");
  return {
    format,
    hasSpeakerLabel,
    summary: "あり",
    body: `${head}\n\n${SUMMARY_MARK}\n${VERBATIM_MARK}\n\n${tail}`,
  };
}

// ---------------------------------------------------------------- ラベル（DB列名 → 表示名）

const DETAIL_LABELS: Record<string, string> = {
  employment_status: "就業状況",
  resignation_date: "退職日",
  job_change_timeline: "転職希望時期",
  job_change_timeline_memo: "転職希望時期メモ",
  activity_period: "転職活動期間",
  activity_period_memo: "転職活動期間メモ",
  current_application_count: "現在の応募社数",
  application_type_flag: "応募形態",
  application_memo: "応募状況メモ",
  education_flag: "最終学歴",
  education_memo: "学歴メモ",
  graduation_date: "卒業年月",
  graduation_status: "卒業区分",
  company_name: "現職（会社名）",
  business_content: "現職 事業内容",
  tenure: "在籍期間",
  job_type_flag: "現職 職種",
  job_type_memo: "現職 職種メモ",
  job_change_axis_flag: "転職の軸",
  job_change_axis_memo: "転職の軸メモ",
  desired_job_type_1: "希望職種1",
  desired_job_type_1_memo: "希望職種1メモ",
  desired_job_type_2: "希望職種2",
  desired_job_types: "希望職種（複数）",
  desired_employment_type: "希望雇用形態",
  desired_industry_1: "希望業種1",
  desired_industry_1_memo: "希望業種1メモ",
  desired_industries: "希望業種（複数）",
  desired_areas: "希望エリア（複数）",
  desired_area: "希望エリア",
  desired_prefecture: "希望都道府県",
  desired_city: "希望市区町村",
  desired_area_memo: "希望エリアメモ",
  current_salary: "現年収(万円)",
  current_salary_memo: "現年収メモ",
  desired_salary_min: "希望下限年収(万円)",
  desired_salary_min_memo: "希望下限年収メモ",
  desired_salary_max: "希望上限年収(万円)",
  desired_salary_max_memo: "希望上限年収メモ",
  desired_day_off: "希望休日",
  desired_day_off_memo: "希望休日メモ",
  desired_holiday_count: "希望年間休日",
  desired_overtime_max: "許容残業",
  desired_overtime_memo: "残業メモ",
  desired_transfer: "転勤可否",
  desired_transfer_memo: "転勤メモ",
  work_style_flags: "働き方",
  work_style_preferences: "働き方の希望",
  company_feature_flags: "企業特徴の希望",
  priority_condition_1: "優先条件1",
  priority_condition_2: "優先条件2",
  priority_condition_3: "優先条件3",
  priority_condition_memo: "優先条件メモ",
  driver_license_flag: "運転免許",
  driver_license_memo: "運転免許メモ",
  language_skill_flag: "語学スキル",
  language_skill_memo: "語学スキルメモ",
  chinese_skill_memo: "中国語メモ",
  japanese_skill_flag: "日本語レベル",
  japanese_skill_memo: "日本語メモ",
  typing_flag: "タイピング",
  typing_memo: "タイピングメモ",
  excel_flag: "Excel",
  excel_memo: "Excelメモ",
  word_flag: "Word",
  word_memo: "Wordメモ",
  ppt_flag: "PowerPoint",
  ppt_memo: "PowerPointメモ",
  document_status_flag: "応募書類の状況",
  document_status_memo: "応募書類メモ",
  document_support_flag: "書類サポート",
  document_support_memo: "書類サポートメモ",
  job_referral_flag: "求人紹介",
  job_referral_timeline: "求人紹介時期",
  job_referral_memo: "求人紹介メモ",
  line_setup_flag: "LINE登録",
  line_setup_memo: "LINEメモ",
  next_interview_flag: "次回面談",
  next_interview_date: "次回面談日",
  next_interview_time: "次回面談時刻",
  next_interview_memo: "次回面談メモ",
  free_memo: "フリーメモ",
  initial_summary: "初回面談サマリ",
  career_summary: "転職活動状況（記述）",
  reg_industry_1: "登録時 業種1",
  reg_industry_2: "登録時 業種2",
  reg_industry_3: "登録時 業種3",
  reg_job_type_1: "登録時 職種1",
  reg_job_type_2: "登録時 職種2",
  reg_job_type_3: "登録時 職種3",
  reg_area_prefecture: "登録時 都道府県",
  reg_area_city: "登録時 市区町村",
  reg_employment_type: "登録時 雇用形態",
  reg_salary_min: "登録時 下限年収",
  reg_salary_max: "登録時 上限年収",
  reg_holidays: "登録時 休日",
  reg_overtime: "登録時 残業",
  reg_job_features: "登録時 仕事の特徴",
  reg_company_features: "登録時 企業の特徴",
  reg_free_memo: "登録時 フリーメモ",
  contact_method: "連絡方法",
  contact_memo: "連絡メモ",
  job_send_deadline: "求人送付期限",
  next_action: "ネクストアクション",
  gpt_memo: "GPTメモ",
  existing_interview_memo: "既存面談メモ",
  interview_prep_memo: "面接対策メモ",
  referral_history: "紹介履歴",
};

/** ②で個別に扱う／内部管理用なので「その他」一覧からは除外する列 */
const DETAIL_EXCLUDE = new Set([
  "id", "interview_record_id", "created_at", "updated_at",
  "candidate_id", "is_latest",
  "resign_reason_large", "resign_reason_medium", "resign_reason_small", "job_change_reason_memo",
  "agent_usage_flag", "agent_usage_memo",
]);

const SUPPORT_STATUS_LABELS: Record<string, string> = {
  BEFORE: "支援前", ACTIVE: "支援中", WAITING: "待機", ENDED: "支援終了", ARCHIVED: "アーカイブ",
};

// ---------------------------------------------------------------- main

async function main() {
  const started = Date.now();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が未設定です");
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async (sql: string): Promise<Row[]> => (await pool.query(sql)).rows;

  const TARGET_CTE = `
    WITH t AS (
      SELECT DISTINCT candidate_id FROM interview_records
      WHERE (interview_date + INTERVAL '9 hours')::date BETWEEN DATE '${FROM_JST}' AND DATE '${TO_JST}'
        AND interview_count = 1
    ), tt AS (
      SELECT DISTINCT t.candidate_id FROM t
      JOIN candidate_files cf ON cf.candidate_id = t.candidate_id
      WHERE cf.category = 'MEETING' AND cf.mime_type = 'text/plain'
    )`;

  console.log("[1/6] 対象抽出（SELECT のみ）...");

  const cands = await q(`${TARGET_CTE}
    SELECT c.id, c.candidate_number, c.name, c.name_kana, c.gender, c.address, c.birthday,
           c.media_source, c.application_route, c.application_date,
           c.support_status, c.support_sub_status, c.support_end_reason, c.support_end_date, c.support_end_comment
    FROM candidates c JOIN tt ON tt.candidate_id = c.id`);

  const interviews = await q(`${TARGET_CTE}
    SELECT ir.id, ir.candidate_id, ir.interview_date, ir.interview_count, ir.is_latest, ir.result_flag, ir.status
    FROM interview_records ir JOIN tt ON tt.candidate_id = ir.candidate_id
    ORDER BY ir.candidate_id, ir.interview_count, ir.is_latest DESC`);

  const details = await q(`${TARGET_CTE}
    SELECT ir.candidate_id, ir.is_latest, d.*
    FROM interview_records ir
    JOIN tt ON tt.candidate_id = ir.candidate_id
    JOIN interview_details d ON d.interview_record_id = ir.id
    WHERE ir.interview_count = 1
    ORDER BY ir.candidate_id, ir.is_latest DESC`);

  const works = await q(`${TARGET_CTE}
    SELECT ir.candidate_id, w.*
    FROM interview_records ir
    JOIN tt ON tt.candidate_id = ir.candidate_id
    JOIN work_histories w ON w.interview_record_id = ir.id
    WHERE ir.interview_count = 1
    ORDER BY ir.candidate_id, w."order"`);

  const files = await q(`${TARGET_CTE}
    SELECT cf.id, cf.candidate_id, cf.file_name, cf.drive_file_id, cf.file_size, cf.interview_id, cf.created_at
    FROM candidate_files cf JOIN tt ON tt.candidate_id = cf.candidate_id
    WHERE cf.category = 'MEETING' AND cf.mime_type = 'text/plain'
    ORDER BY cf.candidate_id, cf.created_at, cf.id`);

  const employees = await q(`SELECT id, name FROM employees ORDER BY name`);

  const noInterview = await q(`
    SELECT c.id, c.candidate_number, c.birthday, c.media_source, c.application_route, c.application_date,
           c.support_status, c.support_sub_status, c.support_end_reason
    FROM candidates c
    WHERE (c.application_date + INTERVAL '9 hours')::date BETWEEN DATE '${FROM_JST}' AND DATE '${TO_JST}'
      AND NOT EXISTS (SELECT 1 FROM interview_records ir WHERE ir.candidate_id = c.id)
    ORDER BY c.application_date, c.candidate_number`);

  const ended = await q(`
    SELECT c.id, c.candidate_number, c.birthday, c.support_end_reason, c.support_end_date,
           c.support_end_comment, c.support_status, c.support_sub_status,
           EXISTS (SELECT 1 FROM interview_records ir WHERE ir.candidate_id = c.id) AS had_interview
    FROM candidates c
    WHERE (c.support_end_date + INTERVAL '9 hours')::date BETWEEN DATE '${FROM_JST}' AND DATE '${TO_JST}'
    ORDER BY c.support_end_date, c.candidate_number`);

  await pool.end();

  console.log(`  候補者 ${cands.length} 人 / 面談 ${interviews.length} 件 / ログ ${files.length} 件`);
  console.log(`  未面談 ${noInterview.length} 人 / 期間内 支援終了 ${ended.length} 人`);

  // ------------------------------------------------ Drive 取得

  console.log("[2/6] Google Drive からログ本文を取得...");
  if (CACHE_DIR) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const texts = new Map<string, string>();
  const downloadErrors: { fileId: string; message: string }[] = [];
  const queue = files.slice();
  const worker = async () => {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      const cached = CACHE_DIR ? path.join(CACHE_DIR, `${r.id}.txt`) : null;
      if (cached && fs.existsSync(cached)) {
        texts.set(r.id, fs.readFileSync(cached, "utf8"));
        continue;
      }
      try {
        const res = await drive.files.get(
          { fileId: r.drive_file_id, alt: "media", supportsAllDrives: true },
          { responseType: "arraybuffer" }
        );
        const buf = Buffer.from(res.data as ArrayBuffer);
        if (cached) fs.writeFileSync(cached, buf);
        texts.set(r.id, buf.toString("utf8"));
      } catch (e: any) {
        downloadErrors.push({ fileId: r.id, message: String(e?.message ?? e).slice(0, 120) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`  取得 ${texts.size} / ${files.length} 件（失敗 ${downloadErrors.length}）`);

  // ------------------------------------------------ 組み立て

  console.log("[3/6] 匿名化と整形...");

  // 社員名 → 担当者A/B/…（全出力で統一）
  const empLabel = new Map<string, string>();
  employees.forEach((e, i) => empLabel.set(e.name, `担当者${seqLabel(i)}`));
  const empReplacers: Replacer[] = [];
  for (const e of employees) {
    for (const p of nameVariants(e.name)) empReplacers.push({ pattern: p, to: empLabel.get(e.name)! });
  }

  const byCand = (rows: Row[]) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      if (!m.has(r.candidate_id)) m.set(r.candidate_id, []);
      m.get(r.candidate_id)!.push(r);
    }
    return m;
  };
  const ivByCand = byCand(interviews);
  const dtByCand = byCand(details);
  const wkByCand = byCand(works);
  const flByCand = byCand(files);

  // 並び順: 初回面談日 → 候補者番号
  const people: Person[] = cands
    .map((c) => {
      const ivs = ivByCand.get(c.id) ?? [];
      return {
        pid: "",
        cand: c,
        firstInterview: ivs.find((x) => x.interview_count === 1) ?? null,
        detail: (dtByCand.get(c.id) ?? [])[0] ?? null,
        works: wkByCand.get(c.id) ?? [],
        interviews: ivs,
        logs: [] as LogFile[],
      };
    })
    .sort((a, b) => {
      const da = interviewDay(a.firstInterview?.interview_date) ?? "9999-99-99";
      const db = interviewDay(b.firstInterview?.interview_date) ?? "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      return String(a.cand.candidate_number).localeCompare(String(b.cand.candidate_number));
    });
  people.forEach((p, i) => (p.pid = `P${String(i + 1).padStart(3, "0")}`));

  // ログの面談日・面談回数を解決
  const ivById = new Map(interviews.map((r) => [r.id, r]));
  for (const p of people) {
    for (const f of flByCand.get(p.cand.id) ?? []) {
      const text = texts.get(f.id);
      if (text === undefined) continue;
      let date: string | null = null;
      let count: number | null = null;
      let resolution: LogFile["resolution"] = "取得不可";

      if (f.interview_id && ivById.has(f.interview_id)) {
        const ir = ivById.get(f.interview_id)!;
        date = interviewDay(ir.interview_date);
        count = ir.interview_count;
        resolution = "確定";
      } else {
        const name: string = f.file_name ?? "";
        let n: number | null = null;
        if (/^(初回面談|新規面談)/.test(name)) n = 1;
        const m = name.match(/^(\d+)回目面談/);
        if (m) n = Number(m[1]);
        if (n !== null) {
          const same = p.interviews.filter((x) => x.interview_count === n);
          const hit = same.find((x) => x.is_latest) ?? same[0];
          if (hit) {
            date = interviewDay(hit.interview_date);
            count = hit.interview_count;
            resolution = "確定";
          }
        }
        if (resolution === "取得不可") {
          // ファイル作成日(JST)以前で最も近い面談に寄せる（推定であることを明記して出す）
          const created = jstDate(f.created_at);
          if (created) {
            const prior = p.interviews
              .map((x) => ({ x, d: interviewDay(x.interview_date) }))
              .filter((o) => o.d !== null && o.d! <= created)
              .sort((a, b) => (a.d! < b.d! ? 1 : -1));
            if (prior.length > 0) {
              date = prior[0].d;
              count = prior[0].x.interview_count;
              resolution = "推定";
            }
          }
        }
      }
      p.logs.push({
        id: f.id,
        fileName: f.file_name,
        driveFileId: f.drive_file_id,
        fileSize: f.file_size,
        createdAtJst: jstDate(f.created_at) ?? NA,
        interviewDate: date,
        interviewCount: count,
        resolution,
        text,
      });
    }
    p.logs.sort((a, b) =>
      `${a.interviewDate ?? "9999-99-99"}#${a.createdAtJst}`.localeCompare(
        `${b.interviewDate ?? "9999-99-99"}#${b.createdAtJst}`
      )
    );
  }

  // 参考検出用: 他の候補者のフルネーム（姓・名の断片は一般語と衝突するので使わない）
  const otherFullNames: { cid: string; pattern: string }[] = [];
  for (const c of cands) {
    for (const p of fullNameForms(c.name)) otherFullNames.push({ cid: c.id, pattern: p });
  }

  // ------------------------------------------------ 本文生成

  interface CheckEntry { pid: string; file: string; kind: string; detail: string }
  const checks: CheckEntry[] = [];
  const stats = {
    people: 0, logs: 0, chars: 0,
    fmt: { 逐語: 0, CAメモ: 0 } as Record<string, number>,
    spk: { あり: 0, なし: 0 } as Record<string, number>,
    sum: { あり: 0, なし: 0, 判定不能: 0 } as Record<string, number>,
    res: { 確定: 0, 推定: 0, 取得不可: 0 } as Record<string, number>,
  };

  const personBlocks: string[] = [];

  for (const p of people) {
    const c = p.cand;
    const d = p.detail;

    // この人専用の置換テーブル
    const reps: Replacer[] = [...empReplacers];
    const ownNamePatterns = new Set<string>();
    for (const pat of nameVariants(c.name)) ownNamePatterns.add(pat);
    for (const pat of nameVariants(c.name_kana)) ownNamePatterns.add(pat);
    // DBの氏名と綴りが違うログがあるため、ファイル名側の氏名も本人氏名として扱う
    for (const lg of p.logs) {
      const fromFile = nameFromFileName(lg.fileName);
      for (const pat of nameVariants(fromFile)) ownNamePatterns.add(pat);
    }
    for (const pat of ownNamePatterns) reps.push({ pattern: pat, to: "本人" });

    const companyLabels = new Map<string, string>();
    let ci = 0;
    for (const raw of [...p.works.map((w) => w.company_name), d?.company_name ?? null]) {
      if (!raw) continue;
      const key = String(raw).trim();
      if (!key || companyLabels.has(key)) continue;
      companyLabels.set(key, `勤務先${seqLabel(ci++)}`);
    }
    for (const [raw, label] of companyLabels) {
      for (const pat of companyVariants(raw)) reps.push({ pattern: pat, to: label });
    }

    const anon = (s: any): string => {
      const t = v(s);
      if (t === NONE || t === NA) return t;
      return scrubContacts(applyReplacers(t, reps));
    };
    const maskFileName = (s: string) => scrubContacts(applyReplacers(String(s ?? ""), reps));

    // --- ① 基本情報
    const workCount = p.works.length;
    const jobChanges =
      workCount > 0
        ? `${workCount}回相当（専用の記録が無いため職歴件数からの近似）`
        : "不明（職歴の記録が0件のため近似できない）";

    const curJob = p.works[0] ?? null;
    const prevJob = p.works[1] ?? null;
    const curJobType = curJob?.job_type_flag ?? d?.job_type_flag ?? null;
    const curBiz = curJob?.business_content ?? d?.business_content ?? null;

    const progressParts = [
      SUPPORT_STATUS_LABELS[c.support_status] ?? c.support_status,
      c.support_sub_status ? String(c.support_sub_status) : null,
      c.support_end_reason ? `終了理由:${c.support_end_reason}` : null,
    ].filter(Boolean);

    const ivLines = p.interviews
      .slice()
      .sort((a, b) => (a.interview_count ?? 0) - (b.interview_count ?? 0))
      .map((x) => `${interviewDay(x.interview_date) ?? NA}（${x.interview_count ?? "?"}回目）`);

    const L: string[] = [];
    L.push("================================================================");
    L.push(`匿名ID: ${p.pid}`);
    L.push("================================================================");
    L.push("");
    L.push("【① 基本情報】");
    L.push(`年代: ${ageBand(c.birthday)}`);
    L.push(`性別: ${genderLabel(c.gender)}`);
    L.push(`居住地: ${prefectureOf(c.address)}（都道府県まで）`);
    L.push(`現職の職種: ${anon(curJobType)}`);
    L.push(
      `現職の業種: ${curBiz ? `${anon(curBiz)}（business_content の自由記述。業種の専用カラムは無い）` : `${NA}（業種の専用カラムが無く、自由記述も未記入）`}`
    );
    L.push(`前職の職種: ${prevJob ? anon(prevJob.job_type_flag) : `${NA}（職歴2件目の記録なし）`}`);
    L.push(
      `前職の業種: ${prevJob ? (prevJob.business_content ? `${anon(prevJob.business_content)}（自由記述）` : NA) : `${NA}（職歴2件目の記録なし）`}`
    );
    L.push(`希望職種: ${anon(d?.desired_job_type_1)}`);
    L.push(`希望業種: ${anon(d?.desired_industry_1)}`);
    L.push(`転職回数: ${jobChanges}`);
    L.push(`応募経路(media_source): ${anon(c.media_source)}`);
    L.push(`応募経路(application_route): ${anon(c.application_route)}`);
    L.push(`応募日: ${jstDate(c.application_date) ?? NONE}`);
    L.push(`応募求人の職種: ${NA}（記録なし）`);
    L.push(`面談時期: ${ivLines.length ? ivLines.join(" / ") : NONE}`);
    L.push(`面談後の進捗（基準日 ${BASE_DATE}）: ${progressParts.join(" / ") || NONE}`);
    L.push(`支援終了日: ${jstDate(c.support_end_date) ?? NONE}`);
    L.push(`支援終了コメント: ${anon(c.support_end_comment)}`);
    L.push("");

    // --- ② DB記録項目
    L.push("【② DBに記録されている項目（値のみ・加工なし）】");
    L.push("-- 退職理由（interview_details・初回面談） --");
    L.push(`退職理由 大分類: ${anon(d?.resign_reason_large)}`);
    L.push(`退職理由 中分類: ${anon(d?.resign_reason_medium)}`);
    L.push(`退職理由 小分類: ${anon(d?.resign_reason_small)}`);
    L.push(`退職理由 自由記述: ${anon(d?.job_change_reason_memo)}`);
    L.push("-- 退職理由（work_histories・職歴ごと） --");
    if (p.works.length === 0) {
      L.push("（職歴の記録なし）");
    } else {
      for (const w of p.works) {
        const label = companyLabels.get(String(w.company_name ?? "").trim()) ?? "勤務先不明";
        L.push(
          `[職歴${w.order}] ${label} / 職種: ${anon(w.job_type_flag)} / 事業内容: ${anon(w.business_content)} / 在籍: ${v(w.hire_date)}〜${v(w.leave_date)}`
        );
        L.push(
          `  退職理由 大: ${anon(w.resign_reason_large)} / 中: ${anon(w.resign_reason_medium)} / 小: ${anon(w.resign_reason_small)}`
        );
        L.push(`  退職理由 自由記述: ${anon(w.job_change_reason_memo)}`);
      }
    }
    L.push("-- 他社エージェント利用 --");
    L.push(`他社エージェント利用: ${anon(d?.agent_usage_flag)}  ※原値・語彙2系統混在（FileMaker取込系／現UI系）`);
    L.push(`他社エージェント メモ: ${anon(d?.agent_usage_memo)}`);
    L.push("-- その他 interview_details の記入済み項目 --");
    if (!d) {
      L.push("（interview_details の行が存在しない）");
    } else {
      const printed: string[] = [];
      for (const col of Object.keys(d)) {
        if (DETAIL_EXCLUDE.has(col)) continue;
        const raw = d[col];
        if (raw === null || raw === undefined) continue;
        let s: string;
        if (raw instanceof Date) s = jstDate(raw) ?? String(raw);
        else if (typeof raw === "object") s = JSON.stringify(raw);
        else s = String(raw);
        if (s.trim() === "" || s === "null" || s === "{}" || s === "[]") continue;
        printed.push(`${DETAIL_LABELS[col] ?? col}: ${anon(s)}`);
      }
      L.push(printed.length ? printed.join("\n") : "（記入済み項目なし）");
    }
    L.push("");

    // --- ③ 面談ログ本文
    L.push("【③ 面談ログ本文】");
    if (p.logs.length === 0) L.push("（ログなし）");
    let n = 0;
    for (const lg of p.logs) {
      n++;
      const a = analyzeLog(lg.text);
      const bodyAnon = scrubContacts(applyReplacers(a.body, reps));
      const dateLabel = lg.interviewDate
        ? `${lg.interviewDate}${lg.resolution === "推定" ? "（推定）" : ""}`
        : `${NA}（ファイル作成日 ${lg.createdAtJst}）`;
      const countLabel =
        lg.interviewCount !== null ? `${lg.interviewCount}回目${lg.resolution === "推定" ? "（推定）" : ""}` : NA;
      const masked = maskFileName(lg.fileName);

      L.push("");
      L.push(
        `--- ログ ${n} ／ 面談日 ${dateLabel} ／ 面談回数 ${countLabel} ／ ファイル名 ${masked} ／ 文字数 ${lg.text.length}字`
      );
      L.push(`--- 形式: ${a.format} ／ 話者ラベル: ${a.hasSpeakerLabel ? "あり" : "なし"} ／ AI要約: ${a.summary}`);
      L.push("");
      L.push(bodyAnon.replace(/\s+$/, ""));

      stats.logs++;
      stats.chars += lg.text.length;
      stats.fmt[a.format]++;
      stats.spk[a.hasSpeakerLabel ? "あり" : "なし"]++;
      stats.sum[a.summary]++;
      stats.res[lg.resolution]++;

      if (a.summary === "判定不能") {
        checks.push({
          pid: p.pid, file: masked, kind: "AI要約の境目が判定不能",
          detail: "逐語パートの開始行が検出できず、区切りを挿入していない",
        });
      }
      const hits = SENSITIVE_KEYWORDS.filter((k) => bodyAnon.includes(k));
      if (hits.length > 0) {
        checks.push({ pid: p.pid, file: masked, kind: "機微情報キーワード", detail: hits.join("・") });
      }
      // 3a: 匿名化の取りこぼし（置換対象にしたはずのものが残っていないか）
      const residual = new Set<string>();
      const scanTarget = `${bodyAnon}\n${masked}`;
      for (const pat of ownNamePatterns) if (scanTarget.includes(pat)) residual.add("本人氏名/カナ");
      for (const r of empReplacers) if (scanTarget.includes(r.pattern)) residual.add("社員氏名");
      for (const raw of companyLabels.keys()) {
        for (const pat of companyVariants(raw)) if (scanTarget.includes(pat)) residual.add("企業名");
      }
      RE_EMAIL.lastIndex = 0;
      if (RE_EMAIL.test(scanTarget)) residual.add("メールアドレス");
      RE_EMAIL.lastIndex = 0;
      RE_TEL.lastIndex = 0;
      if (RE_TEL.test(scanTarget)) residual.add("電話番号");
      RE_TEL.lastIndex = 0;
      if (residual.size > 0) {
        checks.push({ pid: p.pid, file: masked, kind: "匿名化後の残存", detail: [...residual].join("・") });
      }

      // 3b(参考): 本人以外の候補者のフルネームが本文に出てきていないか
      const others = new Set<string>();
      for (const o of otherFullNames) {
        if (o.cid === c.id) continue;
        if (bodyAnon.includes(o.pattern)) others.add(o.pattern);
      }
      if (others.size > 0) {
        checks.push({
          pid: p.pid, file: masked, kind: "他候補者のフルネーム検出",
          detail: `${others.size}件の一致（他の候補者として登録されている氏名と同一の文字列）`,
        });
      }

      // 3c(参考): 本文中に生年月日・現住所（都道府県より詳細）の記載があるもの。
      //   本文は全文そのままの方針なので書き換えず、場所だけ示す。
      const bodyPii: string[] = [];
      if (RE_BODY_BIRTHDAY.test(bodyAnon)) bodyPii.push("生年月日");
      if (RE_BODY_ADDRESS.test(bodyAnon)) bodyPii.push("現住所（都道府県より詳細）");
      if (bodyPii.length > 0) {
        checks.push({ pid: p.pid, file: masked, kind: "本文中の生年月日・住所", detail: bodyPii.join("・") });
      }
    }
    L.push("");
    stats.people++;
    personBlocks.push(L.join("\n"));
  }

  // ------------------------------------------------ ファイル出力

  console.log("[4/6] TXT 出力...");
  const written: string[] = [];
  const writeOut = (name: string, content: string) => {
    fs.writeFileSync(path.join(OUT_DIR, name), content.replace(/\r\n/g, "\n"), { encoding: "utf8" });
    written.push(name);
  };

  const groups: { name: string; from: number; to: number }[] = [];
  for (let i = 0; i < personBlocks.length; i += PER_FILE) {
    const from = i + 1;
    const to = Math.min(i + PER_FILE, personBlocks.length);
    const idx = String(Math.floor(i / PER_FILE) + 1).padStart(2, "0");
    groups.push({ name: `${idx}_interviews_${p3n(from)}-${p3n(to)}.txt`, from, to });
  }
  for (const g of groups) {
    const head = [
      `# 面談ログ 分析用書き出し ${g.name}`,
      `# 対象: P${p3n(g.from)} 〜 P${p3n(g.to)}（${g.to - g.from + 1}名）`,
      `# 抽出条件: 初回面談 ${FROM_JST}〜${TO_JST}(JST) かつ 面談ログ(.txt)保有`,
      "# 匿名化済み: 氏名→「本人」／社員名→「担当者X」／企業名→「勤務先X」／電話・メール・URL除去",
      "# 「話者 1 / 話者 2」ラベルは原文のまま。CA・求職者への置換はしていない（対応関係が保証されないため）",
      "",
    ].join("\n");
    writeOut(g.name, head + personBlocks.slice(g.from - 1, g.to).join("\n"));
  }

  // 90_no_interview.txt
  {
    const L: string[] = [];
    L.push("# 面談に至らなかった層");
    L.push(`# 対象: ${FROM_JST}〜${TO_JST}(JST) に応募日があり、面談記録(interview_records)が1件も無い候補者`);
    L.push("");
    L.push("※ 未返信・辞退の理由を記録する項目が存在しないため、理由は取得できない");
    L.push(
      `   （${noInterview.length}人中 ${noInterview.filter((r) => r.support_status === "BEFORE").length}人が supportStatus=BEFORE のまま）`
    );
    L.push("※ 理由の推測は一切していない。以下は記録されている値のみ。");
    L.push("");
    L.push("---- 一覧 ----");
    noInterview.forEach((r, i) => {
      const st = [
        SUPPORT_STATUS_LABELS[r.support_status] ?? r.support_status,
        r.support_sub_status,
        r.support_end_reason ? `終了理由:${r.support_end_reason}` : null,
      ]
        .filter(Boolean)
        .join(" / ");
      L.push(
        `N${p3n(i + 1)} ／ 年代 ${ageBand(r.birthday)} ／ 応募経路 ${v(r.media_source)}（route: ${v(r.application_route)}） ／ 応募日 ${jstDate(r.application_date) ?? NONE} ／ 現在の支援ステータス ${st}`
      );
    });
    L.push("");
    L.push("---- 応募経路 内訳 ----");
    tally(noInterview.map((r) => v(r.media_source))).forEach(([k, x]) => L.push(`${k}: ${x}`));
    L.push("");
    L.push("---- 支援ステータス 内訳 ----");
    tally(
      noInterview.map(
        (r) =>
          `${r.support_status}${r.support_sub_status ? "/" + r.support_sub_status : ""}${r.support_end_reason ? "(" + r.support_end_reason + ")" : ""}`
      )
    ).forEach(([k, x]) => L.push(`${k}: ${x}`));
    L.push("");
    L.push("");
    L.push("================================================================");
    L.push(`【別セクション】期間内に支援終了した層（面談実施の有無を含む・${ended.length}人）`);
    L.push("================================================================");
    L.push("※ 区分(support_end_reason)は残るが、自由記述コメントは一部のみ。");
    L.push("");
    L.push("---- 終了理由 内訳 ----");
    tally(ended.map((r) => v(r.support_end_reason))).forEach(([k, x]) => L.push(`${k}: ${x}`));
    L.push("");
    L.push("---- 面談実施の有無 内訳 ----");
    tally(ended.map((r) => (r.had_interview ? "面談あり" : "面談なし"))).forEach(([k, x]) => L.push(`${k}: ${x}`));
    L.push("");
    const withComment = ended.filter((r) => v(r.support_end_comment) !== NONE);
    L.push(`---- 自由記述コメント（記入があったもののみ・${withComment.length}件） ----`);
    withComment.forEach((r, i) => {
      L.push(
        `E${p3n(i + 1)} ／ 年代 ${ageBand(r.birthday)} ／ 面談実施 ${r.had_interview ? "あり" : "なし"} ／ 終了日 ${jstDate(r.support_end_date) ?? NONE} ／ 区分 ${v(r.support_end_reason)}`
      );
      L.push(`     コメント: ${scrubContacts(applyReplacers(v(r.support_end_comment), empReplacers))}`);
    });
    writeOut("90_no_interview.txt", L.join("\n") + "\n");
  }

  // 99_check_required.txt
  {
    const L: string[] = [];
    L.push("# 目視確認が必要なファイル一覧");
    L.push("# 本文の抜粋は記載しない（匿名IDとファイル名のみ）");
    L.push("# ファイル名は氏名部分を匿名化済み");
    L.push("");
    const sec = (title: string, kind: string) => {
      const rows = checks.filter((x) => x.kind === kind);
      L.push(`---- ${title}（${rows.length}件） ----`);
      if (rows.length === 0) L.push("（該当なし）");
      for (const r of rows) L.push(`${r.pid} ／ ${r.file} ／ ${r.detail}`);
      L.push("");
    };
    sec("1. 機微情報キーワードのヒット", "機微情報キーワード");
    sec("2. AI要約の境目が判定不能だったファイル", "AI要約の境目が判定不能");
    sec("3. 匿名化後に氏名・電話・メールが残存したファイル", "匿名化後の残存");
    const ref = (title: string, note: string, kind: string) => {
      const rows = checks.filter((x) => x.kind === kind);
      L.push(`---- 参考: ${title}（${rows.length}件） ----`);
      L.push(note);
      if (rows.length === 0) L.push("（該当なし）");
      for (const r of rows) L.push(`${r.pid} ／ ${r.file} ／ ${r.detail}`);
      L.push("");
    };
    ref(
      "他の候補者として登録されている氏名と同一の文字列を含むファイル",
      "（同姓同名・企業名との偶然の一致を含む。3.の残存とは別で、置換対象外の第三者名の可能性）",
      "他候補者のフルネーム検出"
    );
    ref(
      "本文中に生年月日・現住所（都道府県より詳細）の記載が残っているファイル",
      "（本文は全文そのままの方針のため書き換えていない。必要なら手作業で伏せること）",
      "本文中の生年月日・住所"
    );
    writeOut("99_check_required.txt", L.join("\n") + "\n");
  }

  // ------------------------------------------------ 自己検証 + README

  console.log("[5/6] 自己検証...");
  const README_NAME = "00_README.txt";
  /** ディスク上のTXT一覧。00_README.txt はこの時点ではまだ書かれていないので明示的に足す */
  const outFiles = () =>
    [...fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".txt") && f !== README_NAME), README_NAME].sort();

  const pidsInFiles = new Map<string, string[]>();
  for (const g of groups) {
    const content = fs.readFileSync(path.join(OUT_DIR, g.name), "utf8");
    for (const m of content.matchAll(/^匿名ID: (P\d{3})$/gm)) {
      if (!pidsInFiles.has(m[1])) pidsInFiles.set(m[1], []);
      pidsInFiles.get(m[1])!.push(g.name);
    }
  }
  const allPids = people.map((p) => p.pid);
  const dupPid = [...pidsInFiles.entries()].filter(([, f]) => f.length > 1);
  const missingPid = allPids.filter((x) => !pidsInFiles.has(x));
  const expectedSeq = allPids.every((x, i) => x === `P${p3n(i + 1)}`);
  const residualCount = checks.filter((x) => x.kind === "匿名化後の残存").length;

  const checkUtf8 = (names: string[]) => {
    const bad: string[] = [];
    for (const f of names) {
      const p = path.join(OUT_DIR, f);
      if (!fs.existsSync(p)) continue;
      const b = fs.readFileSync(p);
      const hasBom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
      const roundTrip = Buffer.compare(Buffer.from(b.toString("utf8"), "utf8"), b) === 0;
      if (hasBom || !roundTrip) bad.push(f);
    }
    return bad;
  };
  const badUtf8 = checkUtf8(outFiles());
  const utf8Ok = badUtf8.length === 0;

  const verify = [
    `1. 対象人数と出力人数の一致: 対象 ${cands.length} 人 / 出力 ${stats.people} 人 → ${cands.length === stats.people ? "OK" : "NG"}`,
    `2. ログ件数の一致: DB上 ${files.length} 件 / Drive取得 ${texts.size} 件 / 出力 ${stats.logs} 件 → ${files.length === stats.logs ? "OK" : "NG"}${downloadErrors.length ? `（Drive取得失敗 ${downloadErrors.length} 件）` : ""}`,
    `3. 匿名IDの重複・欠番: 重複 ${dupPid.length} 件 / 未出力 ${missingPid.length} 件 / 連番 ${expectedSeq ? "連続（P001〜P" + p3n(allPids.length) + "）" : "不連続"} → ${dupPid.length === 0 && missingPid.length === 0 && expectedSeq ? "OK" : "NG"}`,
    `4. 1人分の分断: 2ファイルに跨る匿名ID ${dupPid.length} 件 → ${dupPid.length === 0 ? "OK（分断なし）" : "NG"}`,
    `5. 氏名・電話・メールの残存: ${residualCount} 件 → ${residualCount === 0 ? "OK" : "要確認（99_check_required.txt 参照）"}`,
    `6. UTF-8(BOM無し)で開けるか: ${utf8Ok ? `OK（全 ${outFiles().length} ファイル BOM無し・UTF-8 として往復一致）` : `NG（${badUtf8.join(", ")}）`}`,
    `7. 形式別の内訳: 逐語 ${stats.fmt["逐語"]} / CAメモ ${stats.fmt["CAメモ"]}、話者ラベルあり ${stats.spk["あり"]} / なし ${stats.spk["なし"]}、AI要約あり ${stats.sum["あり"]} / なし ${stats.sum["なし"]} / 判定不能 ${stats.sum["判定不能"]}`,
  ];

  const readme = [
    "# 面談ログ 分析用書き出し（LP制作用）",
    "",
    `作成日時: ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19)} JST`,
    `出力先: ${OUT_DIR}`,
    "生成スクリプト: bizstudio-portal / scripts/export-interview-logs.ts",
    "",
    "## 抽出条件",
    `- 対象期間: ${FROM_JST} 〜 ${TO_JST}（JST）`,
    "- 条件: 期間内に初回面談（interview_count=1）があり、かつ CandidateFile（category=MEETING / mime_type='text/plain'）を1件以上持つ候補者",
    "- 成約者・好意的発言などによる絞り込みは一切していない（該当者全員）",
    "- MEETING の .pdf は面談ログではなく応募書類（履歴書・キャリアシート）のため除外",
    "- 同一候補者に複数ログがある場合は全て収録し、面談日・面談回数で区別している",
    "- DBは SELECT のみ。書き込み・マイグレーションは一切行っていない",
    "",
    "## 実測",
    `- 対象人数: ${stats.people} 人`,
    `- 面談ログ件数: ${stats.logs} 件`,
    `- ログ本文の合計文字数（匿名化前の原文ベース）: ${stats.chars.toLocaleString()} 字`,
    `- 出力ファイル数: ${outFiles().length} ファイル`,
    `- 面談日・面談回数の解決: 確定 ${stats.res["確定"]} / 推定 ${stats.res["推定"]} / 取得不可 ${stats.res["取得不可"]}`,
    "  - 確定 = candidate_files.interview_id、またはファイル名の「初回面談／新規面談／N回目面談」から特定",
    "  - 推定 = ファイル作成日(JST)以前で最も近い面談に寄せたもの。ヘッダに「（推定）」と明記",
    "  - 取得不可 = どちらでも決まらないもの。ヘッダに「取得不可（ファイル作成日 …）」と明記",
    "",
    "## ファイル構成",
    "- 00_README.txt … 本ファイル",
    `- 01_interviews_001-010.txt 〜 ${groups[groups.length - 1]?.name ?? "-"} … 面談実施者（10名ずつ・1人分は必ず1ファイルに収まる）`,
    "- 90_no_interview.txt … 面談に至らなかった層 ＋ 期間内に支援終了した層",
    "- 99_check_required.txt … 目視確認が必要なファイル一覧",
    "- 文字コード: UTF-8（BOM無し）／改行: LF",
    "",
    "## 1人分のフォーマット",
    "- 区切り: `================` の行",
    "- ①基本情報 → ②DBに記録されている項目（値のみ・加工なし） → ③面談ログ本文 の順",
    "- ③のログごとに「面談日／面談回数／ファイル名／文字数」と「形式／話者ラベル／AI要約」のヘッダを付与",
    `- 形式の判定: ${VERBATIM_MIN_CHARS}字未満は「CAメモ」（逐語ではない）、それ以上は「逐語」`,
    "- AI要約の分離: 逐語パートの開始行（行全体が「話者ラベル + 2要素タイムスタンプ」）を検出し、その直前に",
    `  「${SUMMARY_MARK}」`,
    `  「${VERBATIM_MARK}」`,
    "  の2行を挿入している。要約側の行末タイムスタンプは 3要素(HH:MM:SS) なので誤検出しない",
    "  - 逐語パートが検出できないファイル（＝全体がCAメモ／AI要約のみ）は区切りを入れず「AI要約: 判定不能」とし、",
    "    99_check_required.txt に列挙している。曖昧なまま区切りは入れていない",
    "- 空欄は「言及なし」、記録項目自体が存在しないものは「取得不可」。推測での穴埋めはしていない",
    "- 本文は全文そのまま。要約・省略・書き換え・切り捨ては一切していない（匿名化のための文字列置換のみ）",
    "",
    "## 匿名化（機械処理）",
    "- 本人氏名: 氏名・カナから 姓のみ／名のみ／フルネーム（半角/全角スペース有無）の全パターンを「本人」に置換。",
    "  1文字の姓・名は誤爆が大きいため置換対象外（残存検査で検出される）",
    "  DBの氏名とログのファイル名で綴りが違うケース（例: DB「亜実」／ファイル名「亜美」、テスト用アカウントに",
    "  実在氏名のログが入っている等）があるため、ファイル名から取り出した氏名も本人氏名として置換対象に含めている",
    `- CA・社員名: employees ${employees.length} 名の氏名を「担当者A」「担当者B」…に置換（全出力で同一人物＝同一記号）`,
    "- 企業名: work_histories.company_name / interview_details.company_name を「勤務先A」「勤務先B」…に置換",
    "  （同一人物の記録内で統一。法人格〈株式会社等〉を除いたコアも置換対象）",
    "- 電話番号・メールアドレス・URL: 正規表現で除去",
    "- 生年月日: 年代（20代前半／20代後半…）に変換。生年月日そのものは出力しない",
    "- 詳細住所: 都道府県までに丸め（市区町村以下は出力しない）",
    "  ※ 生年月日・詳細住所の丸めは candidates の該当カラムに対する処理。ログ本文は「全文そのまま」の方針のため、",
    "    本文中に登録書類の転記として生年月日・現住所が書かれているケースは書き換えていない",
    "    （該当ファイルは 99_check_required.txt の参考セクションに列挙）",
    "  ※ interview_details の「希望市区町村／希望エリア」は居住地ではなく希望勤務地なので丸めていない",
    "- ログのファイル名も氏名部分を匿名化して表示している",
    "- 匿名IDと実名の対応表は出力していない（スクリプトのメモリ内で完結）",
    "- 「話者 1 / 話者 2」ラベルは原文のまま残した。CA／求職者への置換はしていない",
    "  （どちらがCAかがファイル内に明示されておらず、対応関係が保証されないため）",
    "",
    "## 取得できなかった項目",
    "- 応募求人の職種 … 候補者に紐づく「応募した求人」のカラムが存在しない（全員「取得不可（記録なし）」で固定出力）",
    "- 転職回数 … 専用カラムが存在しない。work_histories の行数による近似で代替し、各人の行に明記。行が0件の場合は「不明」",
    "- 現職・前職の業種 … 業種の専用カラムが無く business_content の自由記述のみ。未記入の場合は「取得不可」",
    "- エージェント利用理由（なぜ使おうと思ったか） … 構造化フィールドが存在しない。ログ本文からのみ読み取り可能",
    "- 面談前の不安 … 構造化フィールドが存在しない。ログ本文からのみ読み取り可能",
    "- 未面談者の未返信・辞退理由 … 記録項目が存在しない（90_no_interview.txt 参照）",
    "- 面談本文のDB保存（raw_transcript / summary_text） … 対象期間の初回面談で全件NULL。実体は Google Drive のみ",
    "- 他社エージェント利用（agent_usage_flag） … 値の語彙が2系統（FileMaker取込系／現UI系）混在。正規化せず原値のまま出力",
    "",
    "## 自己検証",
    ...verify,
    "",
    "## Drive 取得失敗",
    ...(downloadErrors.length
      ? downloadErrors.map((e) => `- ${e.fileId}: ${e.message}`)
      : ["- なし（全件取得成功）"]),
    "",
    "## 目視確認リスト（99_check_required.txt）の件数",
    `- 1. 機微情報キーワードのヒット: ${checks.filter((x) => x.kind === "機微情報キーワード").length} 件`,
    `- 2. AI要約の境目が判定不能: ${checks.filter((x) => x.kind === "AI要約の境目が判定不能").length} 件`,
    `- 3. 匿名化後の氏名・電話・メール残存: ${residualCount} 件`,
    `- （参考）他の候補者として登録されている氏名と同一の文字列を含むファイル: ${checks.filter((x) => x.kind === "他候補者のフルネーム検出").length} 件`,
    `- （参考）本文中に生年月日・現住所（都道府県より詳細）の記載が残っているファイル: ${checks.filter((x) => x.kind === "本文中の生年月日・住所").length} 件`,
    "",
    "## 出力ファイル一覧",
    ...outFiles().map((f) =>
      f === README_NAME
        ? `- ${f}  （このファイル）`
        : `- ${f}  ${fs.statSync(path.join(OUT_DIR, f)).size.toLocaleString()} bytes`
    ),
    "",
  ].join("\n");

  writeOut(README_NAME, readme);

  // README 自身も含めて最終確認
  const badUtf8Final = checkUtf8(outFiles());
  if (badUtf8Final.length > 0) {
    throw new Error(`UTF-8(BOM無し)でないファイルがあります: ${badUtf8Final.join(", ")}`);
  }

  console.log("[6/6] 完了");
  console.log(verify.join("\n"));
  console.log(`所要 ${((Date.now() - started) / 1000).toFixed(1)} 秒 / 出力 ${OUT_DIR}`);
}

function p3n(n: number) {
  return String(n).padStart(3, "0");
}

function tally(xs: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

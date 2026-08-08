/**
 * RPAスカウト検索条件管理 Phase 1 初期データ投入
 *
 * 実行: npx tsx scripts/rpa-scout/seed-from-csv.ts            # dry-run（パース確認＋移行警告レポート生成のみ）
 *       npx tsx scripts/rpa-scout/seed-from-csv.ts --execute  # DB投入
 *
 * 再実行安全: 各テーブルに既に件数が入っていればスキップする（machines は machineNo で upsert）。
 * 入力: prisma/seed-data/rpa-scout/*.csv（UTF-8・ヘッダーあり。テンプレbodyは改行を含むため csv-parse で読む）
 */
import { prisma } from "@/lib/prisma";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import { jstStringToDbDate } from "@/lib/rpa-scout/jst";

const EXECUTE = process.argv.includes("--execute");
// リポジトリルートから実行する前提（npx tsx scripts/rpa-scout/seed-from-csv.ts）
const DATA_DIR = path.join(process.cwd(), "prisma", "seed-data", "rpa-scout");
const REPORT_PATH = path.join(process.cwd(), "docs", "reports", "RPA検索条件管理_移行警告.md");

type Row = Record<string, string>;

function readCsv(file: string): Row[] {
  const content = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
  return parse(content, { columns: true, skip_empty_lines: true, bom: true }) as Row[];
}

// パース警告の収集（excel_row・列名・原文）
const warnings: { excelRow: string; column: string; raw: string; note: string }[] = [];
function warn(excelRow: string, column: string, raw: string, note: string) {
  warnings.push({ excelRow, column, raw, note });
}

// 全角数字→半角
function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function parseRegistDate(
  raw: string,
  excelRow: string
): { registDays: number | null; registDirection: string | null } {
  const v = normalizeDigits(raw.trim());
  if (!v || v === "-") {
    if (v === "-") warn(excelRow, "regist_date", raw, "パース不能のためnull");
    return { registDays: null, registDirection: null };
  }
  let m = v.match(/^(\d+)日以内$/);
  if (m) return { registDays: Number(m[1]), registDirection: "WITHIN" };
  m = v.match(/^(\d+)日以降$/);
  if (m) return { registDays: Number(m[1]), registDirection: "AFTER" };
  warn(excelRow, "regist_date", raw, "パース不能のためnull");
  return { registDays: null, registDirection: null };
}

function parseLastLogin(raw: string, excelRow: string): number | null {
  const v = normalizeDigits(raw.trim());
  if (!v || v === "-") return null;
  const m = v.match(/^(\d+)日以内$/);
  if (m) return Number(m[1]);
  warn(excelRow, "last_login", raw, "パース不能のためnull");
  return null;
}

function parseResidence(raw: string, excelRow: string): string | null {
  const v = raw.trim();
  if (!v || v === "-") return null;
  if (v === "東日本") return "EAST";
  if (v === "西日本") return "WEST";
  if (v === "全国") return "NATIONWIDE";
  warn(excelRow, "residence", raw, "パース不能のためnull");
  return null;
}

const EDUCATION_VALUES = ["高卒", "専門卒", "短大卒", "高専卒", "大卒", "大学院卒"];
// マイナビ側の表記ゆれ → 本システムの学歴値
const EDUCATION_ALIASES: Record<string, string> = {
  高等学校: "高卒",
  大学: "大卒",
  大学院: "大学院卒",
  短期大学: "短大卒",
  専門学校: "専門卒",
  高等専門学校: "高専卒",
};
function parseEducation(raw: string, excelRow: string): string | null {
  const v = raw.trim();
  if (!v || v === "-") return null;
  if (v === "指定なし" || v === "学歴不問" || v === "不問") return "NONE";
  if (EDUCATION_VALUES.includes(v)) return v;
  const stripped = v.replace(/以上$/, "");
  if (EDUCATION_VALUES.includes(stripped)) return stripped;
  if (EDUCATION_ALIASES[v]) return EDUCATION_ALIASES[v];
  if (EDUCATION_ALIASES[stripped]) return EDUCATION_ALIASES[stripped];
  warn(excelRow, "education_min", raw, "パース不能のためnull");
  return null;
}

function parseGradYear(raw: string, column: string, excelRow: string): number | null {
  const v = normalizeDigits(raw.trim());
  if (!v || v === "-") return null;
  if (/^\d{4}$/.test(v)) return Number(v);
  if (/^\d{2}$/.test(v)) return 2000 + Number(v); // 「24」のような2桁は2000年代に補正
  warn(excelRow, column, raw, "パース不能のためnull");
  return null;
}

function parseCompanyCount(raw: string, excelRow: string): number | null {
  const v = normalizeDigits(raw.trim());
  if (!v || v === "-") return null;
  const m = v.match(/^[～〜]?(\d)社$/);
  if (m && ["1", "2", "3"].includes(m[1])) return Number(m[1]);
  warn(excelRow, "company_count", raw, "パース不能のためnull");
  return null;
}

function parseWorkLocationPriority(raw: string, excelRow: string): string | null {
  const v = raw.trim();
  if (v === "第二希望") return "SECOND";
  if (!v || v === "0" || v === "-") return "NONE";
  warn(excelRow, "work_location_priority", raw, "パース不能のためnull");
  return null;
}

function parseJobCategoryPriority(raw: string, excelRow: string): string | null {
  const v = raw.trim();
  if (!v || v === "0" || v === "-" || v === "指定なし") return null;
  if (v === "第一希望") return "FIRST";
  if (v === "第二希望") return "SECOND";
  warn(excelRow, "job_category_priority", raw, "パース不能のためnull");
  return null;
}

const TRANSFER_TIMINGS = ["すぐにでも", "3カ月以内", "半年以内", "1年以内", "未定"];
function parseTransferTiming(raw: string, excelRow: string): string | null {
  const v = raw.trim();
  if (!v || v === "-") return null;
  if (TRANSFER_TIMINGS.includes(v)) return v;
  // 「～半年以内」のような先頭波線の表記ゆれを吸収
  const stripped = v.replace(/^[～〜]/, "");
  if (TRANSFER_TIMINGS.includes(stripped)) return stripped;
  warn(excelRow, "transfer_timing", raw, "パース不能のためnull");
  return null;
}

function parseJobCategories(
  raw: string,
  excelRow: string,
  validSmalls: Set<string>
): string[] | null {
  const v = raw.trim();
  if (!v || v === "-" || v === "指定なし") return null;
  const parts = v.split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 0 && parts.length <= 3 && parts.every((p) => validSmalls.has(p))) {
    return parts;
  }
  warn(excelRow, "job_category", raw, "小分類名と一致しないためnull");
  return null;
}

function parseWorkLocations(raw: string): string[] | null {
  const v = raw.trim();
  if (!v || v === "-" || v === "指定なし") return null;
  const parts = v.split("/").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

// パターン名の先頭記号から送信状態を判定（ベストエフォート）
function parseSendStatusFromName(name: string): string | null {
  if (name.startsWith("【未送信")) return "UNSENT";
  if (name.startsWith("≪送信済") || name.startsWith("【送信済")) return "SENT";
  return null;
}

// rawConditions に保存する原文15列
const RAW_COLUMNS = [
  "regist_date",
  "last_login",
  "residence",
  "education_min",
  "grad_year_from",
  "grad_year_to",
  "age_max",
  "age_min",
  "company_count",
  "job_category",
  "job_category_priority",
  "work_location",
  "work_location_priority",
  "transfer_timing",
  "own_send",
];

async function main() {
  console.log(`=== RPAスカウト初期データ投入 (${EXECUTE ? "EXECUTE" : "DRY-RUN"}) ===`);

  const machinesCsv = readCsv("rpa-machines.csv");
  const patternsCsv = readCsv("rpa-patterns.csv");
  const templatesCsv = readCsv("rpa-templates.csv");
  const logsCsv = readCsv("rpa-logs.csv");
  const jobCategoriesCsv = readCsv("rpa-job-categories.csv");

  console.log(
    `CSV読込: machines=${machinesCsv.length} patterns=${patternsCsv.length} templates=${templatesCsv.length} logs=${logsCsv.length} job_categories=${jobCategoriesCsv.length}`
  );

  // --- 職種マスタ（0004のINSERT値そのまま。正規化・コード付与はしない） ---
  const validSmalls = new Set(jobCategoriesCsv.map((r) => r.small));

  // --- パターンのパース（ベストエフォート） ---
  const patternRows = patternsCsv.map((r) => {
    const excelRow = r.excel_row;
    const group = r.machine_group.trim();
    const targetMachineNo = /^[1-6]$/.test(group) ? Number(group) : null; // ALL/LEGACY → null
    const { registDays, registDirection } = parseRegistDate(r.regist_date, excelRow);
    const rawConditions: Record<string, string> = {};
    for (const col of RAW_COLUMNS) rawConditions[col] = r[col] ?? "";
    return {
      targetMachineNo,
      name: r.name, // CSVのnameをそのまま（再生成しない）
      sendStatus: parseSendStatusFromName(r.name),
      registDays,
      registDirection,
      lastLoginDays: parseLastLogin(r.last_login, excelRow),
      areaType: parseResidence(r.residence, excelRow),
      education: parseEducation(r.education_min, excelRow),
      gradYearFrom: parseGradYear(r.grad_year_from, "grad_year_from", excelRow),
      gradYearTo: parseGradYear(r.grad_year_to, "grad_year_to", excelRow),
      companyCount: parseCompanyCount(r.company_count, excelRow),
      jobCategories: parseJobCategories(r.job_category, excelRow, validSmalls) ?? undefined,
      jobCategoryPriority: parseJobCategoryPriority(r.job_category_priority, excelRow),
      workLocations: parseWorkLocations(r.work_location) ?? undefined,
      workLocationPriority: parseWorkLocationPriority(r.work_location_priority, excelRow),
      transferTiming: parseTransferTiming(r.transfer_timing, excelRow),
      rawConditions,
      isActive: true,
      isMigrated: true,
    };
  });

  // --- ログのパース ---
  const logRows = logsCsv.map((r, i) => {
    const m = r.machine.trim().match(/^([1-6])号機$/);
    if (!m) throw new Error(`logs行${i + 2}: machine列が不正: ${r.machine}`);
    const timePart = (r.upd_time || "00:00:00").trim();
    // target_date + upd_time をJSTとして合成し、JST壁時計値のままDBへ（罠#17: UTC変換しない）
    const recordedAt = jstStringToDbDate(`${r.target_date.trim()}T${timePart}`);
    return {
      machineNo: Number(m[1]),
      patternId: null, // 移行データはパターンに紐付けしない
      patternName: r.pattern_name,
      subjectTemplateId: null,
      subjectName: r.subject_name,
      searchCount: r.search_count.trim() === "" ? null : Number(r.search_count),
      recordedAt,
    };
  });

  // --- 移行警告レポート ---
  const reportLines = [
    "# RPA検索条件管理 移行警告レポート",
    "",
    `生成: seed-from-csv.ts / パターン ${patternsCsv.length}件を構造化パースした際に null 化した項目の一覧`,
    "",
    `警告件数: ${warnings.length}件`,
    "",
    "| excel_row | 列名 | 原文 | 備考 |",
    "|--|--|--|--|",
    ...warnings.map((w) => `| ${w.excelRow} | ${w.column} | ${w.raw || "(空)"} | ${w.note} |`),
    "",
  ];
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, reportLines.join("\n"), "utf8");
    console.log(`移行警告レポート出力: ${REPORT_PATH}（${warnings.length}件）`);
  } catch (e) {
    console.warn("レポート書き込みに失敗（続行）:", e);
  }

  if (!EXECUTE) {
    console.log("--- dry-run のためDB投入はスキップ ---");
    console.log(`投入予定: machines=${machinesCsv.length} job_categories=${jobCategoriesCsv.length} patterns=${patternRows.length} templates=${templatesCsv.length} logs=${logRows.length}`);
    const sample = logRows[0];
    console.log("logs先頭サンプル recordedAt(DB格納値):", sample.recordedAt.toISOString());
    return;
  }

  // ============ 投入（再実行安全） ============

  // 1. machines: machineNo で upsert
  for (const r of machinesCsv) {
    await prisma.rpaScoutMachine.upsert({
      where: { machineNo: Number(r.machine_no) },
      create: {
        machineNo: Number(r.machine_no),
        accountName: r.account_name,
        employeeCode: r.employee_code,
        mynaviSaveName: r.mynavi_save_name,
        isActive: r.is_active.trim().toLowerCase() === "true",
      },
      update: {
        accountName: r.account_name,
        employeeCode: r.employee_code,
        mynaviSaveName: r.mynavi_save_name,
        isActive: r.is_active.trim().toLowerCase() === "true",
      },
    });
  }
  console.log(`machines: upsert ${machinesCsv.length}件`);

  // 2. job_categories: 既に入っていればスキップ
  const jcCount = await prisma.rpaScoutJobCategory.count();
  if (jcCount > 0) {
    console.log(`job_categories: 既に${jcCount}件あるためスキップ`);
  } else {
    await prisma.rpaScoutJobCategory.createMany({
      data: jobCategoriesCsv.map((r) => ({
        large: r.large,
        middle: r.middle,
        small: r.small,
        sortOrder: Number(r.sort_order),
      })),
    });
    console.log(`job_categories: INSERT ${jobCategoriesCsv.length}件`);
  }

  // 3. templates: 既に入っていればスキップ（name=停止 は is_active=false のまま入れる）
  const tplCount = await prisma.rpaScoutSubjectTemplate.count();
  if (tplCount > 0) {
    console.log(`templates: 既に${tplCount}件あるためスキップ`);
  } else {
    await prisma.rpaScoutSubjectTemplate.createMany({
      data: templatesCsv.map((r) => ({
        name: r.name,
        subject: r.subject,
        body: r.body || null,
        isActive: r.is_active.trim().toLowerCase() === "true",
      })),
    });
    console.log(`templates: INSERT ${templatesCsv.length}件`);
  }

  // 4. patterns: 既に入っていればスキップ
  const patCount = await prisma.rpaScoutPattern.count();
  if (patCount > 0) {
    console.log(`patterns: 既に${patCount}件あるためスキップ`);
  } else {
    for (const p of patternRows) {
      await prisma.rpaScoutPattern.create({ data: p });
    }
    console.log(`patterns: INSERT ${patternRows.length}件`);
  }

  // 5. logs: 既に入っていればスキップ
  const logCount = await prisma.rpaScoutLog.count();
  if (logCount > 0) {
    console.log(`logs: 既に${logCount}件あるためスキップ`);
  } else {
    // createMany を分割投入
    const chunkSize = 200;
    for (let i = 0; i < logRows.length; i += chunkSize) {
      await prisma.rpaScoutLog.createMany({ data: logRows.slice(i, i + chunkSize) });
    }
    console.log(`logs: INSERT ${logRows.length}件`);
  }

  // 件数照合
  const [mc, pc, tc, lc, jc] = await Promise.all([
    prisma.rpaScoutMachine.count(),
    prisma.rpaScoutPattern.count(),
    prisma.rpaScoutSubjectTemplate.count(),
    prisma.rpaScoutLog.count(),
    prisma.rpaScoutJobCategory.count(),
  ]);
  console.log("=== 件数照合 ===");
  console.log(`machines=${mc} (期待6) ${mc === 6 ? "OK" : "NG"}`);
  console.log(`patterns=${pc} (期待117) ${pc === 117 ? "OK" : "NG"}`);
  console.log(`templates=${tc} (期待16) ${tc === 16 ? "OK" : "NG"}`);
  console.log(`logs=${lc} (期待1192) ${lc === 1192 ? "OK" : "NG"}`);
  console.log(`job_categories=${jc} (期待378) ${jc === 378 ? "OK" : "NG"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

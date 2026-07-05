/**
 * T-135 step9: applicationDate 一括補完スクリプト（RPA スカウト取込・6/21以前分）
 *
 * 背景（docs/survey_T-135_timezone_drift.md）:
 *   応募日の自動記録は 2026-06-21 commit ad043cd で導入。それ以前の RPA スカウト取込 262 件は
 *   applicationDate が null。stats API applied バケットの createdAt フォールバック計算は正しいが、
 *   applicationDate に実値が入るほうが集計・エクスポート・後続改修が明快なため後付けする。
 *
 * 補完式（単一・調査で検証済み）:
 *   application_date = DATE_TRUNC('day', created_at + INTERVAL '9 hours')
 *   （= createdAt を JST に変換した暦日の 00:00 UTC で格納。既存 parseYmdToDate と同形式）
 *
 * 対象: application_route = 'スカウト' AND application_date IS NULL（想定 262 件）
 *   スカウト経路以外・applicationDate 設定済みには一切触れない。冪等（再実行しても 0 件）。
 *
 * 実行:
 *   npx tsx scripts/backfill-application-date-t135.ts             # DRY-RUN（既定・読み取りのみ）
 *   npx tsx scripts/backfill-application-date-t135.ts --execute   # 本実行（rollback CSV 保存後に UPDATE）
 *
 * CSV: verify/t135-appdate-backfill-{dry-run|execute}-{YYYYMMDD-HHMM}.csv
 *      execute で rollback 用の (candidateNumber, 旧 applicationDate=null, 新値) を残す
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE: "DRY-RUN" | "EXECUTE" = EXECUTE ? "EXECUTE" : "DRY-RUN";

// 11名検証セット: 全員 2026-06-01 になるべき（前回調査で確定）
const TEST_CANDIDATE_NUMBERS = [
  "5008005",
  "5008006",
  "5008007",
  "5008008",
  "5008009",
  "5008010",
  "5008011",
  "5008012",
  "5008013",
  "5008014",
  "5008015",
];

type TargetRow = {
  id: string;
  candidateNumber: string;
  createdAt: Date;
  backfillValue: Date;
  ymJst: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function timestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

async function main() {
  console.log(`[${MODE}] T-135 applicationDate backfill start`);

  // ---- 対象取得（補完予定値を DB 側で計算・そのまま CSV/検証に使う）----
  const targets = await prisma.$queryRaw<TargetRow[]>`
    SELECT
      id,
      candidate_number AS "candidateNumber",
      created_at AS "createdAt",
      DATE_TRUNC('day', created_at + INTERVAL '9 hours') AS "backfillValue",
      to_char(created_at + INTERVAL '9 hours', 'YYYY-MM') AS "ymJst"
    FROM candidates
    WHERE application_route = 'スカウト'
      AND application_date IS NULL
    ORDER BY created_at
  `;

  console.log(`\n対象件数: ${targets.length}`);

  // ---- 月別内訳 ----
  const monthMap = new Map<string, number>();
  for (const t of targets) monthMap.set(t.ymJst, (monthMap.get(t.ymJst) ?? 0) + 1);
  console.log("\n月別内訳（createdAt+9h の JST 年月）:");
  for (const [ym, cnt] of Array.from(monthMap.entries()).sort()) {
    console.log(`  ${ym}: ${cnt}`);
  }

  // ---- 11名検証セット ----
  const testHits = targets.filter((t) => TEST_CANDIDATE_NUMBERS.includes(t.candidateNumber));
  console.log(`\n11名検証セット（5008005〜5008015）:`);
  console.log(`  該当件数: ${testHits.length} / 期待: 11`);
  const allJune1 = testHits.every((t) => utcYmd(t.backfillValue) === "2026-06-01");
  console.log(`  全員 2026-06-01: ${allJune1 ? "OK" : "NG"}`);
  for (const t of testHits) {
    console.log(
      `  ${t.candidateNumber}: createdAt=${t.createdAt.toISOString()} → applicationDate=${utcYmd(t.backfillValue)}`,
    );
  }

  // 検証セットのズレを報告（停止はしない・DRY-RUN 報告に含める）
  if (testHits.length !== 11) {
    console.log(
      `  ⚠️ 11名の該当件数が ${testHits.length} 件。候補者番号違い or 既に applicationDate 設定済み or 経路変更を確認`,
    );
  }
  if (!allJune1) {
    console.log(`  ⚠️ 全員 2026-06-01 でない。createdAt の分布を確認`);
    for (const t of testHits) {
      if (utcYmd(t.backfillValue) !== "2026-06-01") {
        console.log(`    ${t.candidateNumber}: ${utcYmd(t.backfillValue)}`);
      }
    }
  }

  // ---- CSV 保存 ----
  const verifyDir = path.join(process.cwd(), "verify");
  fs.mkdirSync(verifyDir, { recursive: true });
  const csvName = `t135-appdate-backfill-${MODE === "EXECUTE" ? "execute" : "dry-run"}-${timestamp()}.csv`;
  const csvPath = path.join(verifyDir, csvName);
  const header = "candidateNumber,createdAt,previousApplicationDate,newApplicationDate\n";
  const body = targets
    .map((t) => `${t.candidateNumber},${t.createdAt.toISOString()},,${utcYmd(t.backfillValue)}`)
    .join("\n");
  fs.writeFileSync(csvPath, header + body + (body ? "\n" : ""));
  console.log(`\nCSV: ${csvPath}`);

  if (!EXECUTE) {
    console.log("\n[DRY-RUN] UPDATE スキップ。--execute で本実行。");
    return;
  }

  // ---- EXECUTE: UPDATE ----
  // 生SQLで一括更新（Prisma の @updatedAt は生SQLでは発火しないため updated_at は変わらない = 意図どおり）
  const updated = await prisma.$executeRaw`
    UPDATE candidates
    SET application_date = DATE_TRUNC('day', created_at + INTERVAL '9 hours')
    WHERE application_route = 'スカウト'
      AND application_date IS NULL
  `;
  console.log(`\n[EXECUTE] UPDATE 完了: ${updated} 行`);

  if (updated !== targets.length) {
    console.log(
      `  ⚠️ 更新件数 ${updated} が事前取得 ${targets.length} と不一致。同時実行 or 前提変化を確認`,
    );
  }

  // ---- 事後検証 ----
  const remaining = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*) AS cnt FROM candidates
    WHERE application_route = 'スカウト' AND application_date IS NULL
  `;
  console.log(`\n事後: application_route='スカウト' で application_date IS NULL の残: ${remaining[0].cnt}`);

  const verifyRes = await prisma.$queryRaw<Array<{ candidateNumber: string; jst: string }>>`
    SELECT candidate_number AS "candidateNumber",
      to_char(application_date, 'YYYY-MM-DD') AS jst
    FROM candidates
    WHERE candidate_number IN ('5008005','5008006','5008007','5008008','5008009','5008010','5008011','5008012','5008013','5008014','5008015')
    ORDER BY candidate_number
  `;
  console.log(`\n11名 事後 applicationDate:`);
  for (const r of verifyRes) console.log(`  ${r.candidateNumber}: ${r.jst}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

/**
 * T-067: FileMaker 由来の「開放日/通常」を過去分の Candidate.masType へ一括投入する移行スクリプト。
 *
 * 入力CSV: masType_backfill_マイナビ転職.csv（列: candidateNumber,masType・1行目ヘッダ・BOMなしUTF-8）
 *   マイナビ転職のみ・"開放日"/"通常" の値ありのみに前処理済み（媒体フィルタ不要）。
 *
 * 仕様:
 *   - Candidate.candidateNumber(String) == csv.candidateNumber(文字列照合) で1件特定。
 *   - FileMaker値を正とし、現在の masType と異なる場合のみ UPDATE（冪等・旧担当者ベース値も上書き訂正）。
 *   - dry-run は DB を一切書き換えず集計のみ。
 *
 * 実行:
 *   # DRY RUN（DB 書き込みなし・既定）
 *   npx tsx scripts/backfill-mastype-from-filemaker.ts --dry-run
 *   # 本番実行（DB 書き込み）※ dry-run 報告後・OK のときのみ
 *   npx tsx scripts/backfill-mastype-from-filemaker.ts --execute
 *   # CSVパス上書き（任意）
 *   npx tsx scripts/backfill-mastype-from-filemaker.ts --execute --csv=path/to.csv
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ALLOWED = new Set(["開放日", "通常"]);

function parseArgs() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const csvArg = args.find((a) => a.startsWith("--csv="));
  const csvPath = csvArg ? csvArg.slice("--csv=".length) : "masType_backfill_マイナビ転職.csv";
  return { execute, csvPath };
}

type Row = { candidateNumber: string; masType: string };

function readCsv(csvPath: string): { rows: Row[]; invalidCount: number; totalLines: number } {
  const raw = fs.readFileSync(path.resolve(csvPath), "utf8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  const totalLines = lines.length;
  const rows: Row[] = [];
  let invalidCount = 0;
  for (let i = 1; i < lines.length; i++) { // 1行目ヘッダをスキップ
    const cols = lines[i].split(",");
    const candidateNumber = (cols[0] ?? "").trim();
    const masType = (cols[1] ?? "").trim();
    if (!candidateNumber || !ALLOWED.has(masType)) { invalidCount++; continue; }
    rows.push({ candidateNumber, masType });
  }
  return { rows, invalidCount, totalLines };
}

async function main() {
  const { execute, csvPath } = parseArgs();
  const mode = execute ? "EXECUTE（DB更新）" : "DRY-RUN（DB書き込みなし）";
  console.log(`=== backfill masType from FileMaker / ${mode} / csv=${csvPath} ===`);

  const { rows, invalidCount, totalLines } = readCsv(csvPath);
  console.log(`CSV 総行数(ヘッダ含む): ${totalLines} / データ行(有効): ${rows.length} / 無効スキップ: ${invalidCount}`);

  // 1) CSV の candidateNumber 群を一括取得（4308件を1クエリで・プロキシ越しでも高速）
  const csvNumbers = rows.map((r) => r.candidateNumber);
  const found = await prisma.candidate.findMany({
    where: { candidateNumber: { in: csvNumbers } },
    select: { candidateNumber: true, masType: true },
  });
  const byNum = new Map(found.map((c) => [c.candidateNumber, c.masType] as const));

  let matched = 0;
  let notFound = 0;
  let nullToValue = 0;   // 現在null → 値が入る
  let valueChanged = 0;  // 現在「開放日/通常」だが値が変わる（旧担当者ベース訂正）
  let noChange = 0;      // 現在と同じ
  let updated = 0;
  const samples: { candidateNumber: string; from: string | null; to: string }[] = [];
  const toKaihoubi: string[] = []; // 変更が必要かつ CSV値=開放日
  const toTsuujou: string[] = [];  // 変更が必要かつ CSV値=通常

  for (const row of rows) {
    if (!byNum.has(row.candidateNumber)) { notFound++; continue; }
    matched++;
    const cur = byNum.get(row.candidateNumber) ?? null;
    if (cur === row.masType) { noChange++; continue; }
    // 変更が必要
    if (cur == null) nullToValue++; else valueChanged++;
    if (samples.length < 10) samples.push({ candidateNumber: row.candidateNumber, from: cur, to: row.masType });
    (row.masType === "開放日" ? toKaihoubi : toTsuujou).push(row.candidateNumber);
  }

  // 2) execute: 変更が必要な candidateNumber のみを値別に updateMany（IN対象=変更行のみ＝count=実更新数・冪等）
  if (execute) {
    if (toKaihoubi.length) {
      updated += (await prisma.candidate.updateMany({ where: { candidateNumber: { in: toKaihoubi } }, data: { masType: "開放日" } })).count;
    }
    if (toTsuujou.length) {
      updated += (await prisma.candidate.updateMany({ where: { candidateNumber: { in: toTsuujou } }, data: { masType: "通常" } })).count;
    }
  }

  const willUpdate = nullToValue + valueChanged;
  console.log("\n--- 集計 ---");
  console.log(`matched(該当あり): ${matched}`);
  console.log(`notFound(candidateNumber未存在): ${notFound}`);
  console.log(`willUpdate(変更されることになる数): ${willUpdate}`);
  console.log(`  ├ null→値: ${nullToValue}`);
  console.log(`  └ 値変更(旧値訂正): ${valueChanged}`);
  console.log(`noChange(変更不要): ${noChange}`);
  if (execute) console.log(`updated(実更新件数): ${updated}`);
  console.log("\n--- 変更サンプル(最大10件) ---");
  for (const s of samples) console.log(`  ${s.candidateNumber}: ${s.from ?? "(null)"} → ${s.to}`);

  // 全体内訳
  const dist = await prisma.candidate.groupBy({ by: ["masType"], _count: { _all: true } });
  console.log("\n--- 投入後 Candidate.masType 全体内訳 ---");
  for (const d of dist) console.log(`  ${d.masType ?? "(null)"}: ${d._count._all}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  await pool.end();
  process.exit(1);
});

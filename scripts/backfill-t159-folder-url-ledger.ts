/**
 * T-159 Phase 3: OneDriveFolderUrlLedger の遡り登録（T-158 で一括登録した1,734件ぶん）。
 *
 *   npx tsx scripts/backfill-t159-folder-url-ledger.ts             # dry-run（DBに書かない）
 *   npx tsx scripts/backfill-t159-folder-url-ledger.ts --execute   # 台帳へ INSERT
 *
 * ★なぜ必要か。機能2（フォルダ移動追随）は「台帳にあるURLだけ書き換える」設計であり、
 *   台帳が空だと 1,734件すべてが「手貼り」に見えて1件も追随しない。
 *   T-158 の一括登録は自動処理の産物なので、その事実を台帳に写して追随の対象に含める。
 *
 * ★出所は推測しない。T-158 が実際に UPDATE した行を記録した
 *     docs/reports/T-158_backup_before_update.csv   （Phase 2-B: 番号一致＋氏名検証）
 *     docs/reports/T-158c_backup_before_update.csv  （Phase 2-C: 氏名完全一致＋担当CA姓一致）
 *   を唯一の入力とし、**現在のDB値が当時書いた値と byte 一致する行だけ**台帳に載せる。
 *   一致しない行は「T-158 の後で CA が手で貼り替えた」ものなので載せない（＝以後も守られる）。
 *
 * ★DB以外には触らない。Graph も Google Drive も呼ばないので、ローカルから実行してよい
 *   （夜間処理そのものはローカルから実行してはいけない: GOOGLE_SERVICE_ACCOUNT_KEY が空で
 *     lastAttemptedAt を汚すため）。
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { LEDGER_SOURCE } from "@/lib/onedrive-folder-url-sync";
import { restoreDrivePathFromFolderUrl } from "@/lib/onedrive-sync";

const CSV_FILES = [
  "docs/reports/T-158_backup_before_update.csv",
  "docs/reports/T-158c_backup_before_update.csv",
];

interface CsvRow {
  id: string;
  candidateNumber: string;
  urlAfter: string;
}

/** 単純な CSV パーサ。この2ファイルは値に "," や引用符を含まない（URLは percent-encode 済み）。 */
function readCsv(file: string): CsvRow[] {
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error(`[NG] 入力がありません: ${file}`);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  const iId = header.indexOf("id");
  const iNo = header.indexOf("candidate_number");
  const iAfter = header.indexOf("onedrive_folder_url_after");
  if (iId < 0 || iNo < 0 || iAfter < 0) {
    console.error(`[NG] 想定の列がありません: ${file} (${header.join(" / ")})`);
    process.exit(1);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return { id: cols[iId], candidateNumber: cols[iNo], urlAfter: cols[iAfter] };
  });
}

async function main() {
  const execute = process.argv.includes("--execute");

  const rows = CSV_FILES.flatMap(readCsv);
  console.log(`[OK] T-158 の更新記録 ${rows.length} 件を読み込みました`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: [...byId.keys()] } },
    select: {
      id: true,
      candidateNumber: true,
      oneDriveFolderUrl: true,
      oneDriveFolderUrlLedger: { select: { id: true, autoUrl: true } },
    },
  });
  console.log(`[OK] DB 上に現存する求職者 ${candidates.length} 件`);

  const counts = {
    match: 0, // 現在値が T-158 の値と一致 → 台帳に載せる
    changed: 0, // 一致しない（手で貼り替えられた）→ 載せない
    cleared: 0, // URL が消えている → 載せない
    alreadyLedger: 0, // 既に台帳がある（再実行）
    badUrl: 0, // 復元できない値 → 載せない
    missingInDb: byId.size - candidates.length,
  };

  const toWrite: { candidateId: string; autoUrl: string; drivePath: string }[] = [];

  for (const c of candidates) {
    const src = byId.get(c.id)!;
    if (!c.oneDriveFolderUrl) {
      counts.cleared++;
      continue;
    }
    if (c.oneDriveFolderUrl !== src.urlAfter) {
      counts.changed++;
      continue;
    }
    const restored = restoreDrivePathFromFolderUrl(c.oneDriveFolderUrl);
    if (!restored.ok) {
      // T-158 が書いた形式なら必ず復元できる。できないなら前提が崩れているので載せない。
      counts.badUrl++;
      continue;
    }
    if (c.oneDriveFolderUrlLedger) {
      counts.alreadyLedger++;
      if (c.oneDriveFolderUrlLedger.autoUrl === c.oneDriveFolderUrl) continue;
    }
    counts.match++;
    toWrite.push({
      candidateId: c.id,
      autoUrl: c.oneDriveFolderUrl,
      drivePath: restored.folderPath,
    });
  }

  console.log("\n=== 突合結果 ===");
  console.log(`  台帳に載せる（現在値がT-158の値と一致）        ${counts.match}`);
  console.log(`  載せない: T-158後に手で貼り替えられた           ${counts.changed}`);
  console.log(`  載せない: URLが消えている                       ${counts.cleared}`);
  console.log(`  載せない: URLからパスを復元できない             ${counts.badUrl}`);
  console.log(`  既に台帳がある（再実行）                        ${counts.alreadyLedger}`);
  console.log(`  DBに存在しない求職者（削除済み）                ${counts.missingInDb}`);

  if (counts.match === 0) {
    console.log("\n[i] 書き込むものがありません。");
    await prisma.$disconnect();
    return;
  }

  if (!execute) {
    console.log("\n[dry-run] DBには書き込んでいません。実行するには --execute を付けてください。");
    console.log("  例（先頭3件）:");
    for (const w of toWrite.slice(0, 3)) console.log(`    ${w.candidateId}  ${w.drivePath}`);
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const w of toWrite) {
    await prisma.oneDriveFolderUrlLedger.upsert({
      where: { candidateId: w.candidateId },
      create: { ...w, source: LEDGER_SOURCE.T158_BACKFILL },
      update: { autoUrl: w.autoUrl, drivePath: w.drivePath, source: LEDGER_SOURCE.T158_BACKFILL },
    });
    written++;
    if (written % 200 === 0) console.log(`  ... ${written}/${toWrite.length}`);
  }

  const total = await prisma.oneDriveFolderUrlLedger.count();
  console.log(`\n[OK] 台帳へ ${written} 件を登録しました。台帳の総件数: ${total}`);
  await prisma.$disconnect();
}

void main();

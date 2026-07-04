/**
 * T-128 続き: 株式会社リンクスタッフ・株式会社日本ビジネスDPC の externalJobNo 正値化
 *
 * 前提:
 *   fix-t128-linkstaff-jbdpc.ts で jobDb='HITO-Link' には修正済み。
 *   externalJobNo が leading-ID（34232 / 22169）のまま残っており、これは元PDFの
 *   別ソース由来ID（求人番号ラベル）で HITO-Link の hl-ap 番号ではない可能性が高い。
 *
 * 対象2件（現 jobDb='HITO-Link' AND isActive=true）:
 *   #18 リンクスタッフ  entryId=cmr1m3qqb003w1dn6o7zjdoy8  externalJobNo=34232
 *   #19 日本ビジネスDPC entryId=cmqolu3g5009w1dnthlmtyhf8  externalJobNo=22169
 *
 * 抽出:
 *   対応 CandidateFile.extractedText から /hl-ap-?(\d{5,7})/i を第一候補として検索。
 *   川崎3件の HITO-Link ネイティブ PDF は本文冒頭に `hl-ap-XXXXX BZ-XXXXX 求 人 情 報`
 *   が入るため確定できるが、本2件は別ソースのPDFで hl-ap が存在しないため抽出失敗の
 *   可能性が高い（要 dry-run 結果確認）。参考情報として 求人ID/求人番号 ラベル近傍の
 *   数字も検出しログ出力するが、決定に使うのは hl-ap のみ（プロンプト仕様準拠）。
 *
 * 更新（プロンプト仕様）:
 *   - hl-ap 抽出成功: externalJobNo = 抽出した hl-ap 数字
 *   - hl-ap 抽出失敗: externalJobNo = null（誤情報を残さない）
 *   - jobDb は HITO-Link のまま（本スクリプトでは変更しない）
 *   - jobType は前スクリプトで null 化済のため変更なし
 *
 * 冪等・失敗隔離。--dry-run（既定）/ --execute。
 * ロールバック CSV を verify/ に出力（execute でも出力）。
 *
 * 実行:
 *   npx tsx scripts/fix-t128-linkstaff-jbdpc-num.ts            # DRY-RUN
 *   npx tsx scripts/fix-t128-linkstaff-jbdpc-num.ts --execute  # 本実行
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
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

const HL_RE = /hl-ap-?(\d{5,7})/i;
const HL_RE_G = /hl-ap-?(\d{5,7})/gi;
// 参考ラベル（決定には使わない・報告のみ）
const KYUUJIN_LABEL_RE = /(求人ID|求人番号|案件ID|掲載ID|求人No)[\s　]*[:：]?[\s　]*(\d{4,9})/g;

// entryId 明示・スコープ限定
type Target = {
  label: string;
  entryId: string;
  expectedCurrentJobDb: string;
  expectedCurrentJobNo: string;
  fileHint: string; // 対応 bookmark を fileName 先頭で選ぶためのヒント
};

const TARGETS: Target[] = [
  { label: "株式会社リンクスタッフ",                             entryId: "cmr1m3qqb003w1dn6o7zjdoy8", expectedCurrentJobDb: "HITO-Link", expectedCurrentJobNo: "34232", fileHint: "34232_" },
  { label: "株式会社日本ビジネスデータープロセシングセンター", entryId: "cmqolu3g5009w1dnthlmtyhf8", expectedCurrentJobDb: "HITO-Link", expectedCurrentJobNo: "22169", fileHint: "22169_" },
];

function ts(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${day}-${h}${mm}`;
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type Extraction = {
  hlHit: string | null;
  hlSnippet: string;
  labelHits: Array<{ label: string; num: string }>;
};

function extract(text: string | null): Extraction {
  if (!text) return { hlHit: null, hlSnippet: "", labelHits: [] };
  const m = text.match(HL_RE);
  const hlHit = m ? m[1] : null;
  let hlSnippet = "";
  if (m) {
    const idx = m.index ?? 0;
    const s = Math.max(0, idx - 40);
    const e = Math.min(text.length, idx + m[0].length + 60);
    hlSnippet = text.slice(s, e).replace(/\s+/g, " ");
  }
  // 参考: 求人ID / 求人番号 等の label 近傍
  const labelHits: Array<{ label: string; num: string }> = [];
  let lm: RegExpExecArray | null;
  KYUUJIN_LABEL_RE.lastIndex = 0;
  while ((lm = KYUUJIN_LABEL_RE.exec(text)) !== null) {
    labelHits.push({ label: lm[1], num: lm[2] });
  }
  // dedupe
  const seen = new Set<string>();
  const uniq = labelHits.filter((h) => {
    const k = `${h.label}:${h.num}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { hlHit, hlSnippet, labelHits: uniq };
}

async function main() {
  console.log(`=== T-128 リンクスタッフ / 日本ビジネスDPC externalJobNo 正値化 (mode=${MODE}) ===\n`);

  type Plan = {
    label: string;
    entryId: string;
    entryCompanyName: string;
    bookmarkId: string | null;
    bookmarkFileName: string | null;
    driveFileId: string | null;
    extractedTextLength: number;
    beforeJobDb: string | null;
    beforeJobNo: string | null;
    afterJobNo: string | null; // null = 空にする, string = 上書き
    afterJobNoAction: "SET_NULL" | "SET_VALUE" | "NOOP_UNCHANGED";
    hlHit: string | null;
    hlSnippet: string;
    labelHits: Array<{ label: string; num: string }>;
  };

  const plans: Plan[] = [];

  for (const t of TARGETS) {
    const entry = await prisma.jobEntry.findUnique({
      where: { id: t.entryId },
      select: { id: true, companyName: true, jobDb: true, jobType: true, externalJobNo: true, candidateId: true },
    });
    if (!entry) {
      console.error(`  ⚠ entryId=${t.entryId} 見つからず。スキップ`);
      continue;
    }
    if (entry.jobDb !== t.expectedCurrentJobDb) {
      console.log(`  ℹ entryId=${t.entryId} は jobDb=${entry.jobDb}（期待=${t.expectedCurrentJobDb}）→ 前提と異なるためスキップ`);
      continue;
    }
    // 対応 bookmark（同一 candidateId、fileName が hint で始まる、active、lastExportedTo='hito-link'）
    const bms = await prisma.candidateFile.findMany({
      where: { candidateId: entry.candidateId, category: "BOOKMARK", archivedAt: null, lastExportedTo: "hito-link" },
      select: { id: true, fileName: true, driveFileId: true, extractedText: true },
    });
    const bm = bms.find((b) => b.fileName.startsWith(t.fileHint));
    if (!bm) {
      console.warn(`  ⚠ entryId=${t.entryId} 対応 bookmark（fileName^=${t.fileHint}）見つからず → hl-ap 抽出不可・null 化`);
      plans.push({
        label: t.label,
        entryId: t.entryId,
        entryCompanyName: entry.companyName,
        bookmarkId: null,
        bookmarkFileName: null,
        driveFileId: null,
        extractedTextLength: 0,
        beforeJobDb: entry.jobDb,
        beforeJobNo: entry.externalJobNo,
        afterJobNo: null,
        afterJobNoAction: entry.externalJobNo == null ? "NOOP_UNCHANGED" : "SET_NULL",
        hlHit: null,
        hlSnippet: "",
        labelHits: [],
      });
      continue;
    }

    const ex = extract(bm.extractedText);

    let afterJobNo: string | null;
    let action: Plan["afterJobNoAction"];
    if (ex.hlHit) {
      afterJobNo = ex.hlHit;
      action = ex.hlHit === entry.externalJobNo ? "NOOP_UNCHANGED" : "SET_VALUE";
    } else {
      afterJobNo = null;
      action = entry.externalJobNo == null ? "NOOP_UNCHANGED" : "SET_NULL";
    }

    plans.push({
      label: t.label,
      entryId: t.entryId,
      entryCompanyName: entry.companyName,
      bookmarkId: bm.id,
      bookmarkFileName: bm.fileName,
      driveFileId: bm.driveFileId,
      extractedTextLength: bm.extractedText?.length ?? 0,
      beforeJobDb: entry.jobDb,
      beforeJobNo: entry.externalJobNo,
      afterJobNo,
      afterJobNoAction: action,
      hlHit: ex.hlHit,
      hlSnippet: ex.hlSnippet,
      labelHits: ex.labelHits,
    });
  }

  console.log(`\n=== 抽出結果 ===`);
  for (const p of plans) {
    console.log(`  ${p.label} entryId=${p.entryId}`);
    console.log(`    bookmarkFileName=${p.bookmarkFileName ?? "(none)"} extractedTextLength=${p.extractedTextLength}`);
    console.log(`    hl-ap: ${p.hlHit ? `HIT ${p.hlHit} / snippet="${p.hlSnippet}"` : "FAIL（本文に hl-ap-\\d+ 出現なし）"}`);
    if (p.labelHits.length > 0) {
      const lh = p.labelHits.map((h) => `${h.label}=${h.num}`).join(" / ");
      console.log(`    参考: ラベル付き ID 検出 → ${lh}（決定には使わない・情報のみ）`);
    }
    console.log(`    externalJobNo: ${p.beforeJobNo ?? "null"} → ${p.afterJobNo ?? "null"} (${p.afterJobNoAction})`);
  }

  // ---------- ロールバック CSV ----------
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  const rbPath = path.join(verifyDir, `t128-linkstaff-jbdpc-num-rollback-${MODE.toLowerCase()}-${stamp}.csv`);
  const rows: string[] = [];
  rows.push(
    [
      "label", "entryId", "entryCompanyName",
      "bookmarkId", "bookmarkFileName", "driveFileId", "extractedTextLength",
      "beforeJobDb", "beforeExternalJobNo",
      "afterExternalJobNo", "afterJobNoAction",
      "hlHit", "hlSnippet",
      "labelHits(json)",
    ].map(csvEscape).join(","),
  );
  for (const p of plans) {
    rows.push([
      p.label, p.entryId, p.entryCompanyName,
      p.bookmarkId, p.bookmarkFileName, p.driveFileId, p.extractedTextLength,
      p.beforeJobDb, p.beforeJobNo,
      p.afterJobNo, p.afterJobNoAction,
      p.hlHit, p.hlSnippet,
      JSON.stringify(p.labelHits),
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(rbPath, rows.join("\n"), "utf8");
  console.log(`\nRollback CSV: ${rbPath}`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 処理未実行。--execute を付けて再実行してください。)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ---------- EXECUTE ----------
  console.log(`\n=== EXECUTE ===`);
  let ok = 0;
  let err = 0;
  let noop = 0;
  for (const p of plans) {
    if (p.afterJobNoAction === "NOOP_UNCHANGED") {
      noop++;
      console.log(`  ○ ${p.label} entryId=${p.entryId} 変更不要（before=after）`);
      continue;
    }
    try {
      await prisma.jobEntry.update({
        where: { id: p.entryId },
        data: { externalJobNo: p.afterJobNo }, // null または hl-ap
      });
      ok++;
      console.log(`  ✓ ${p.label} entryId=${p.entryId} externalJobNo: ${p.beforeJobNo ?? "null"} → ${p.afterJobNo ?? "null"}`);
    } catch (e) {
      err++;
      console.error(`  ✗ update failed entryId=${p.entryId}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  JobEntry 更新: 成功=${ok} / no-op=${noop} / 失敗=${err}`);

  // 検証: 残マイナビJOB + 対象2件の現状
  const remaining = await prisma.jobEntry.count({ where: { jobDb: "マイナビJOB", isActive: true } });
  const verifyRows = await prisma.jobEntry.findMany({
    where: { id: { in: TARGETS.map((t) => t.entryId) } },
    select: { id: true, jobDb: true, externalJobNo: true, jobType: true },
  });
  console.log(`\n[検証] 残 jobDb='マイナビJOB' AND isActive=true 件数: ${remaining}`);
  console.log(`[検証] 対象2件の現在値:`);
  for (const v of verifyRows) console.log(`  ${v.id}: jobDb=${v.jobDb}, externalJobNo=${v.externalJobNo ?? "null"}, jobType=${v.jobType ?? "null"}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});

/**
 * T-128 Phase2-1 続き3: 川崎優太（5008136）2026-07-02 エントリー3件の HITO-Link 正値化
 *
 * 対象エントリー（entryId 明示・スコープ限定）:
 *   - 日本郵政不動産株式会社   entryId=cmr33td5w008y1dqlqfqsodx2  bookmark=cmr19s3cz003l1dr3xgziowoe
 *   - 農林中央金庫             entryId=cmr33td5w008x1dql7fn4s8uj  bookmark=cmr19s8dv003o1dr3famken4e
 *   - 穴吹興産株式会社         entryId=cmr33td5w008z1dqlj4jeunay  bookmark=cmr19rb6p003d1dr3bkogj100
 *
 * 背景: 担当CA確認により実体は HITO-Link 経由の求人と確定。現状 jobDb='マイナビJOB'。
 *       ブックマークは PDF由来（sourceType=null）で job-platform を通っていないため
 *       Phase2-1 スクリプトの突合対象外だった。ブックマークの extractedText 先頭に
 *       HITO-Link ID（hl-ap-\d{5,7}）が既に埋まっていることを確認済み。
 *
 * 抽出:
 *   CandidateFile.extractedText から `hl-ap-?\d{5,7}` を検索し、末尾の数字を採用。
 *   複数ヒット時は最初の値を採用。抽出できなかった件は externalJobNo を触らない。
 *
 * 更新:
 *   jobDb='HITO-Link'（3件とも）
 *   externalJobNo = 抽出成功時のみ更新（失敗時は既存値維持）
 *   jobType が HITO-Link 選択肢（DODA求人 / パーソル求人）外なら null リセット
 *
 * 冪等・失敗隔離。--dry-run 既定 / --execute。
 * ロールバックCSVを verify/ に出力。
 *
 * 実行（本番コンテナ上）:
 *   railway ssh
 *     npx tsx scripts/fix-t128-kawasaki-3entries.ts            # DRY-RUN
 *     npx tsx scripts/fix-t128-kawasaki-3entries.ts --execute  # 本実行
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

const TARGET_JOB_DB = "HITO-Link";
const HITO_LINK_JOB_TYPES = new Set(["DODA求人", "パーソル求人"]);
const HL_ID_RE = /hl-ap-?(\d{5,7})/i;

// entryId → bookmarkFileId の明示ペア（対象を限定するためコードにハードコード）。
const TARGETS: Array<{ label: string; entryId: string; fileId: string }> = [
  { label: "日本郵政不動産株式会社", entryId: "cmr33td5w008y1dqlqfqsodx2", fileId: "cmr19s3cz003l1dr3xgziowoe" },
  { label: "農林中央金庫",             entryId: "cmr33td5w008x1dql7fn4s8uj", fileId: "cmr19s8dv003o1dr3famken4e" },
  { label: "穴吹興産株式会社",         entryId: "cmr33td5w008z1dqlj4jeunay", fileId: "cmr19rb6p003d1dr3bkogj100" },
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

function extractHlId(text: string | null): { hlId: string | null; snippet: string } {
  if (!text) return { hlId: null, snippet: "" };
  const m = text.match(HL_ID_RE);
  if (!m) return { hlId: null, snippet: "" };
  // 抽出根拠として前後 40 文字を返す。
  const idx = m.index ?? 0;
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + m[0].length + 20);
  const snippet = text.slice(start, end).replace(/\s+/g, " ");
  return { hlId: m[1], snippet };
}

async function main() {
  console.log(`=== T-128 川崎優太3件 HITO-Link 正値化 (mode=${MODE}) ===`);

  type Plan = {
    label: string;
    entryId: string;
    fileId: string;
    entryCompanyName: string;
    beforeJobDb: string | null;
    afterJobDb: string;
    beforeJobNo: string | null;
    afterJobNo: string | null; // null = 抽出失敗のため触らない
    beforeJobType: string | null;
    afterJobType: string | null;
    resetJobType: boolean;
    hlId: string | null;
    snippet: string;
  };

  const plans: Plan[] = [];

  for (const t of TARGETS) {
    const [entry, file] = await Promise.all([
      prisma.jobEntry.findUnique({
        where: { id: t.entryId },
        select: { id: true, companyName: true, jobDb: true, jobType: true, externalJobNo: true, candidateId: true },
      }),
      prisma.candidateFile.findUnique({
        where: { id: t.fileId },
        select: { id: true, fileName: true, extractedText: true, candidateId: true },
      }),
    ]);
    if (!entry) {
      console.error(`  ⚠ entryId=${t.entryId} 見つからず。スキップ`);
      continue;
    }
    if (!file) {
      console.error(`  ⚠ fileId=${t.fileId} 見つからず。スキップ`);
      continue;
    }
    // Safety: 対象候補者が一致することを確認。
    if (entry.candidateId !== file.candidateId) {
      console.error(`  ⚠ candidateId 不一致 entry=${entry.candidateId} file=${file.candidateId}。スキップ`);
      continue;
    }
    const { hlId, snippet } = extractHlId(file.extractedText);
    const currentType = entry.jobType;
    const needsReset = currentType != null && !HITO_LINK_JOB_TYPES.has(currentType);
    plans.push({
      label: t.label,
      entryId: t.entryId,
      fileId: t.fileId,
      entryCompanyName: entry.companyName,
      beforeJobDb: entry.jobDb,
      afterJobDb: TARGET_JOB_DB,
      beforeJobNo: entry.externalJobNo,
      afterJobNo: hlId ?? null,
      beforeJobType: currentType,
      afterJobType: needsReset ? null : currentType,
      resetJobType: needsReset,
      hlId,
      snippet,
    });
  }

  console.log(`\n=== 抽出結果 ===`);
  for (const p of plans) {
    const ok = p.hlId ? "OK" : "FAIL";
    console.log(`  [${ok}] ${p.label} entryId=${p.entryId}`);
    console.log(`     hlId=${p.hlId ?? "null"}, snippet="${p.snippet}"`);
    console.log(`     jobDb: ${p.beforeJobDb ?? "null"} → ${p.afterJobDb}`);
    console.log(`     jobNo: ${p.beforeJobNo ?? "null"} → ${p.afterJobNo ?? "(触らない)"}`);
    console.log(`     jobType: ${p.beforeJobType ?? "null"} → ${p.afterJobType ?? "null"}${p.resetJobType ? " (reset)" : ""}`);
  }

  const successCount = plans.filter((p) => p.hlId).length;
  const resetCount = plans.filter((p) => p.resetJobType).length;
  console.log(`\n件数: 対象=${plans.length} / 番号抽出成功=${successCount} / 番号抽出失敗=${plans.length - successCount} / jobType リセット=${resetCount}`);

  // ---------- ロールバック CSV ----------
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  const rbPath = path.join(verifyDir, `t128-kawasaki-3entries-rollback-${MODE.toLowerCase()}-${stamp}.csv`);
  const rows: string[] = [];
  rows.push(
    ["label", "entryId", "fileId", "entryCompanyName", "beforeJobDb", "beforeExternalJobNo", "beforeJobType", "afterJobDb", "afterExternalJobNo", "afterJobType", "resetJobType", "hlId", "extractSnippet"]
      .map(csvEscape)
      .join(","),
  );
  for (const p of plans) {
    rows.push([
      p.label,
      p.entryId,
      p.fileId,
      p.entryCompanyName,
      p.beforeJobDb,
      p.beforeJobNo,
      p.beforeJobType,
      p.afterJobDb,
      p.afterJobNo,
      p.afterJobType,
      p.resetJobType ? "1" : "0",
      p.hlId,
      p.snippet,
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

  // ---------- 実行 ----------
  console.log(`\n=== EXECUTE ===`);
  let ok = 0;
  let err = 0;
  for (const p of plans) {
    try {
      await prisma.jobEntry.update({
        where: { id: p.entryId },
        data: {
          jobDb: p.afterJobDb,
          ...(p.hlId ? { externalJobNo: p.hlId } : {}), // 抽出成功時のみ更新
          ...(p.resetJobType ? { jobType: null } : {}),
        },
      });
      ok++;
    } catch (e) {
      err++;
      console.error(`  update failed entryId=${p.entryId}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  JobEntry 更新: 成功=${ok} / 失敗=${err}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});

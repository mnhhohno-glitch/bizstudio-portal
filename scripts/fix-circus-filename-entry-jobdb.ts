/**
 * T-128 Phase2-1 続き: Circus形式ファイル名 PDF ブックマーク由来エントリーの正値化
 *
 * Phase2-1 の fix-jobplatform-entry-jobdb.ts は sourceType='job-platform' 経由のみ対象だが、
 * それ以外に「Circus形式PDFを手動アップロードしたブックマーク（sourceType=null）」経由で
 * エントリー化された行にも同型のズレ（jobDb='マイナビJOB' + externalJobNo=内部連番）が残る。
 * このスクリプトは Circus 命名規則（fileName に `_No\d{5,7}`）で確定できる分だけを機械的に修正する。
 *
 * 対象:
 *   JobEntry で jobDb='マイナビJOB' AND isActive=true、
 *   対応する CandidateFile（同一 candidateId・会社名一致・category=BOOKMARK・archivedAt=null）の
 *   fileName が `_No\d{5,7}` パターンにマッチするもの。
 *
 * 更新内容:
 *   jobDb = 'Circus'
 *   externalJobNo = fileName の No 以降の数字（例: `_No135308.pdf` → "135308"）
 *   jobType が Circus の選択肢外なら null にリセット（HITO-Link 用「DODA求人 / パーソル求人」等が残っているケース）
 *
 * Circus の求人種別選択肢（lib/constants/job-types.ts:JOB_TYPE_BY_ROUTE より）:
 *   自社求人 / 事務局求人 / 直接求人 / share求人
 *
 * 冪等・失敗隔離。--dry-run 既定 / --execute。
 * ロールバック CSV を verify/ に出力（execute でも出力）。
 *
 * 実行（本番コンテナ上）:
 *   railway ssh
 *     npx tsx scripts/fix-circus-filename-entry-jobdb.ts            # DRY-RUN
 *     npx tsx scripts/fix-circus-filename-entry-jobdb.ts --execute  # 本実行
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

const TARGET_JOB_DB = "Circus";
// lib/job-platform-ingest.ts detectMediaFromFilename と同一パターン。
const CIRCUS_NO_RE = /_No(\d{5,7})/i;
// lib/constants/job-types.ts JOB_TYPE_BY_ROUTE["Circus"] と同一。
const CIRCUS_JOB_TYPES = new Set(["自社求人", "事務局求人", "直接求人", "share求人"]);

// 会社名の正規化（fix-jobplatform-entry-jobdb.ts と同ルール）。
function normalizeCompany(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社/g, "")
    .replace(/\s+/g, "")
    .trim();
}

// Circus ファイル名から会社名部分を復元して正規化。
//   `株式会社ネクストビート_No135308.pdf` → 株式会社ネクストビート → normalize
//   `求人票_XXX_No999999.pdf` は 求人票_ プレフィックスも除去（念のため）
function companyKeyFromCircusFileName(fileName: string): string {
  const s = fileName
    .replace(/\.pdf$/i, "")
    .replace(/^求人票[_]?/, "")
    .replace(/_No\d{5,7}$/i, "");
  return normalizeCompany(s);
}

function extractCircusNoFromFileName(fileName: string): string | null {
  const m = fileName.match(CIRCUS_NO_RE);
  return m ? m[1] : null;
}

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

async function main() {
  console.log(`=== T-128 Circus形式ファイル名 正値化 (mode=${MODE}) ===`);

  // ---------- 対象エントリー抽出 ----------
  const entries = await prisma.jobEntry.findMany({
    where: { jobDb: "マイナビJOB", isActive: true },
    select: {
      id: true,
      candidateId: true,
      companyName: true,
      jobDb: true,
      jobType: true,
      externalJobId: true,
      externalJobNo: true,
      entryDate: true,
    },
    orderBy: [{ candidateId: "asc" }, { entryDate: "desc" }],
  });

  const candidateIds = [...new Set(entries.map((e) => e.candidateId))];

  // 対象候補者の Circus 命名規則ブックマーク（fileName に _No\d{5,7} を含む・active）を収集。
  const circusBookmarks = await prisma.candidateFile.findMany({
    where: {
      candidateId: { in: candidateIds },
      category: "BOOKMARK",
      archivedAt: null,
    },
    select: { id: true, candidateId: true, fileName: true, sourceType: true, externalJobRef: true },
  });

  // candidateId → normalizedCompany → { fileName, circusNo }
  const bookmarkIdx = new Map<string, Map<string, { fileName: string; circusNo: string }>>();
  for (const bm of circusBookmarks) {
    if (!CIRCUS_NO_RE.test(bm.fileName)) continue;
    const key = companyKeyFromCircusFileName(bm.fileName);
    const no = extractCircusNoFromFileName(bm.fileName);
    if (!key || !no) continue;
    if (!bookmarkIdx.has(bm.candidateId)) bookmarkIdx.set(bm.candidateId, new Map());
    const inner = bookmarkIdx.get(bm.candidateId)!;
    if (!inner.has(key)) inner.set(key, { fileName: bm.fileName, circusNo: no });
  }

  type EntryPlan = {
    id: string;
    candidateId: string;
    companyName: string;
    beforeJobDb: string | null;
    afterJobDb: string;
    beforeJobNo: string | null;
    afterJobNo: string;
    beforeJobType: string | null;
    afterJobType: string | null;
    resetJobType: boolean;
    matchedFileName: string;
  };

  const plans: EntryPlan[] = [];
  for (const e of entries) {
    const idx = bookmarkIdx.get(e.candidateId);
    if (!idx) continue;
    const key = normalizeCompany(e.companyName);
    let hit = idx.get(key);
    if (!hit) {
      // 部分一致フォールバック（fileName 復元と DB 表記のズレ吸収）。
      for (const [bkey, bval] of idx) {
        if (bkey && (bkey.includes(key) || key.includes(bkey))) {
          hit = bval;
          break;
        }
      }
    }
    if (!hit) continue;

    const currentType = e.jobType;
    const needsReset = currentType != null && !CIRCUS_JOB_TYPES.has(currentType);
    plans.push({
      id: e.id,
      candidateId: e.candidateId,
      companyName: e.companyName,
      beforeJobDb: e.jobDb,
      afterJobDb: TARGET_JOB_DB,
      beforeJobNo: e.externalJobNo,
      afterJobNo: hit.circusNo,
      beforeJobType: currentType,
      afterJobType: needsReset ? null : currentType,
      resetJobType: needsReset,
      matchedFileName: hit.fileName,
    });
  }

  // 差分が発生する行のみ実質対象。
  const changed = plans.filter(
    (p) =>
      p.beforeJobDb !== p.afterJobDb ||
      (p.beforeJobNo ?? null) !== p.afterJobNo ||
      p.resetJobType,
  );

  console.log(`\n対象エントリー (jobDb='マイナビJOB' AND isActive=true): ${entries.length}件`);
  console.log(`  Circus形式ブックマークと会社名一致: ${plans.length}件`);
  console.log(`  差分あり: ${changed.length}件`);

  const resetCount = changed.filter((p) => p.resetJobType).length;
  console.log(`  求人種別リセット対象: ${resetCount}件`);

  // ---------- ロールバック CSV ----------
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  const rbPath = path.join(verifyDir, `t128-circus-fix-rollback-${MODE.toLowerCase()}-${stamp}.csv`);
  {
    const rows: string[] = [];
    rows.push(
      ["entryId", "candidateId", "companyName", "beforeJobDb", "beforeExternalJobNo", "beforeJobType", "afterJobDb", "afterExternalJobNo", "afterJobType", "resetJobType", "matchedFileName"]
        .map(csvEscape)
        .join(","),
    );
    for (const p of changed) {
      rows.push([
        p.id,
        p.candidateId,
        p.companyName,
        p.beforeJobDb,
        p.beforeJobNo,
        p.beforeJobType,
        p.afterJobDb,
        p.afterJobNo,
        p.afterJobType,
        p.resetJobType ? "1" : "0",
        p.matchedFileName,
      ].map(csvEscape).join(","));
    }
    fs.writeFileSync(rbPath, rows.join("\n"), "utf8");
    console.log(`\nRollback CSV: ${rbPath}`);
  }

  // ---------- 全件一覧 ----------
  console.log(`\n=== 差分あり全件一覧（${changed.length}件） ===`);
  console.log("candidateId, entryId, 会社名, jobDb: before→after, externalJobNo: before→after, jobType: before→after(reset), matchedFile");
  for (const p of changed) {
    console.log(
      `  ${p.candidateId} ${p.id} "${p.companyName}" | jobDb: ${p.beforeJobDb ?? "null"} → ${p.afterJobDb} | jobNo: ${p.beforeJobNo ?? "null"} → ${p.afterJobNo} | jobType: ${p.beforeJobType ?? "null"} → ${p.afterJobType ?? "null"}${p.resetJobType ? " (reset)" : ""} | ${p.matchedFileName}`,
    );
  }

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
  for (const p of changed) {
    try {
      await prisma.jobEntry.update({
        where: { id: p.id },
        data: {
          jobDb: p.afterJobDb,
          externalJobNo: p.afterJobNo,
          ...(p.resetJobType ? { jobType: null } : {}),
        },
      });
      ok++;
    } catch (e) {
      err++;
      console.error(`  update failed entryId=${p.id}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  JobEntry 更新: 成功=${ok} / 失敗=${err}（うち jobType リセット対象: ${resetCount}件）`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});

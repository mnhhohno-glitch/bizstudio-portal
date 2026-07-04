/**
 * T-128 Phase2-1: job-platform 経由求人の媒体・求人番号の正値化＋既存エントリー一括修正
 *
 * 対象:
 *  (a) CandidateFile (sourceType="job-platform"): sourceMedia が null の全件に 'hito_link' を投入。
 *       現状 job-platform 経由の求人は 100% HITO-Link（74,038件実測）。
 *  (b) JobEntry: (a) の CandidateFile と candidateId＋会社名で突合したエントリーを
 *       jobDb='HITO-Link'、externalJobNo=元番号（externalJobRef 末尾数字）へ更新。
 *       jobType が HITO-Link の選択肢（DODA求人 / パーソル求人）外なら null にリセット。
 *
 * 冪等・失敗隔離（行単位）。--dry-run（既定）/ --execute。
 * 実行前に対象全件のロールバック用CSVを verify/ に出力する（execute でもファイル出力）。
 *
 * 実行（本番コンテナ上）:
 *   railway ssh
 *     npx tsx scripts/fix-jobplatform-entry-jobdb.ts            # DRY-RUN
 *     npx tsx scripts/fix-jobplatform-entry-jobdb.ts --execute  # 本実行
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
const TARGET_SOURCE_MEDIA = "hito_link";
// HistoryTab / lib/constants/job-types.ts: HITO-Link の求人種別選択肢。
const HITO_LINK_JOB_TYPES = new Set(["DODA求人", "パーソル求人"]);

// externalJobRef の末尾の連続数字を求人番号として取り出す。
function extractJobNoFromRef(externalJobRef: string | null | undefined): string | null {
  if (!externalJobRef) return null;
  const m = externalJobRef.match(/(\d+)\s*$/);
  return m ? m[1] : externalJobRef;
}

// 会社名の正規化（HistoryTab の findBookmarkRating と同じルール）。
function normalizeCompany(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社/g, "")
    .replace(/\s+/g, "")
    .trim();
}

// fileName から会社名を復元して正規化（求人票_{会社名}_{数値ID}.pdf / 求人票_{会社名}.pdf 両対応）。
function companyKeyFromFileName(fileName: string): string {
  const s = fileName
    .replace(/\.pdf$/i, "")
    .replace(/^求人票[_]?/, "")
    .replace(/_\d{10,}$/, "");
  return normalizeCompany(s);
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
  console.log(`=== T-128 Phase2-1 一括修正 (mode=${MODE}) ===`);

  // ---------- (a) CandidateFile: sourceMedia 投入 ----------
  const filesToTouch = await prisma.candidateFile.findMany({
    where: {
      sourceType: "job-platform",
      sourceMedia: null,
    },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      externalJobRef: true,
      sourceMedia: true,
      createdAt: true,
    },
    orderBy: [{ candidateId: "asc" }, { createdAt: "asc" }],
  });

  console.log(`\n[A] CandidateFile 対象: ${filesToTouch.length}件 (sourceType='job-platform' AND sourceMedia IS NULL)`);

  // ---------- (b) JobEntry 突合 ----------
  // candidateId ごとに job-platform ブックマークをまとめ、正規化会社名 → externalJobRef のマップを作る。
  // 既に sourceMedia がセット済みの行も後段の JobEntry 突合には使えるため、両方を集める。
  const allJobPlatformBookmarks = await prisma.candidateFile.findMany({
    where: { sourceType: "job-platform" },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      externalJobRef: true,
      sourceMedia: true,
    },
  });

  // candidateId → normalizedCompany → { externalJobRef, sourceMedia }
  const bookmarkIdx = new Map<string, Map<string, { externalJobRef: string | null; sourceMedia: string | null }>>();
  for (const bm of allJobPlatformBookmarks) {
    const key = companyKeyFromFileName(bm.fileName);
    if (!key) continue;
    if (!bookmarkIdx.has(bm.candidateId)) bookmarkIdx.set(bm.candidateId, new Map());
    const inner = bookmarkIdx.get(bm.candidateId)!;
    // job-platform bookmark 同士で会社名衝突があった場合は最初の登録を優先（先入れ）。
    if (!inner.has(key)) {
      inner.set(key, { externalJobRef: bm.externalJobRef, sourceMedia: bm.sourceMedia });
    }
  }

  const candidateIdsWithJP = Array.from(bookmarkIdx.keys());

  // job-platform ブックマークを持つ candidateId のエントリーだけ引く（絞込 + 全件処理）。
  const candidateEntries = await prisma.jobEntry.findMany({
    where: { candidateId: { in: candidateIdsWithJP } },
    select: {
      id: true,
      candidateId: true,
      companyName: true,
      jobDb: true,
      jobType: true,
      externalJobId: true,
      externalJobNo: true,
      entryDate: true,
      createdAt: true,
    },
    orderBy: [{ candidateId: "asc" }, { entryDate: "desc" }],
  });

  type EntryPlan = {
    id: string;
    candidateId: string;
    companyName: string;
    beforeJobDb: string | null;
    afterJobDb: string;
    beforeJobNo: string | null;
    afterJobNo: string | null;
    beforeJobType: string | null;
    afterJobType: string | null; // null=リセット
    resetJobType: boolean;
    matchedExternalJobRef: string | null;
  };

  const plans: EntryPlan[] = [];
  for (const e of candidateEntries) {
    const idx = bookmarkIdx.get(e.candidateId);
    if (!idx) continue;
    const key = normalizeCompany(e.companyName);
    let src = idx.get(key);
    if (!src) {
      // 部分一致フォールバック（fileName 由来 key と DB 上 companyName 表記のズレ吸収）。
      for (const [bkey, bsrc] of idx) {
        if (bkey && (bkey.includes(key) || key.includes(bkey))) {
          src = bsrc;
          break;
        }
      }
    }
    if (!src) continue;

    const afterJobNo = extractJobNoFromRef(src.externalJobRef);
    const currentType = e.jobType;
    const needsReset = currentType != null && !HITO_LINK_JOB_TYPES.has(currentType);
    plans.push({
      id: e.id,
      candidateId: e.candidateId,
      companyName: e.companyName,
      beforeJobDb: e.jobDb,
      afterJobDb: TARGET_JOB_DB,
      beforeJobNo: e.externalJobNo,
      afterJobNo,
      beforeJobType: currentType,
      afterJobType: needsReset ? null : currentType,
      resetJobType: needsReset,
      matchedExternalJobRef: src.externalJobRef,
    });
  }

  // 差分が発生する行のみ実質対象。
  const changed = plans.filter(
    (p) =>
      p.beforeJobDb !== p.afterJobDb ||
      (p.beforeJobNo ?? null) !== (p.afterJobNo ?? null) ||
      p.resetJobType,
  );

  console.log(`\n[B] JobEntry 突合: ${candidateEntries.length}件中 一致=${plans.length}件・差分あり=${changed.length}件`);

  const resetCount = changed.filter((p) => p.resetJobType).length;
  console.log(`  求人種別リセット対象: ${resetCount}件`);

  // ---------- ロールバックCSV出力 ----------
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();

  const rbFilesPath = path.join(verifyDir, `t128-p2-fix-rollback-files-${MODE.toLowerCase()}-${stamp}.csv`);
  const rbEntriesPath = path.join(verifyDir, `t128-p2-fix-rollback-entries-${MODE.toLowerCase()}-${stamp}.csv`);

  {
    const rows: string[] = [];
    rows.push(["fileId", "candidateId", "fileName", "externalJobRef", "beforeSourceMedia"].map(csvEscape).join(","));
    for (const f of filesToTouch) {
      rows.push([f.id, f.candidateId, f.fileName, f.externalJobRef, f.sourceMedia].map(csvEscape).join(","));
    }
    fs.writeFileSync(rbFilesPath, rows.join("\n"), "utf8");
    console.log(`\n[A] Rollback CSV (CandidateFile): ${rbFilesPath}`);
  }

  {
    const rows: string[] = [];
    rows.push(
      ["entryId", "candidateId", "companyName", "beforeJobDb", "beforeExternalJobNo", "beforeJobType", "afterJobDb", "afterExternalJobNo", "afterJobType", "resetJobType", "matchedExternalJobRef"]
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
        p.matchedExternalJobRef,
      ].map(csvEscape).join(","));
    }
    fs.writeFileSync(rbEntriesPath, rows.join("\n"), "utf8");
    console.log(`[B] Rollback CSV (JobEntry): ${rbEntriesPath}`);
  }

  // ---------- 全件一覧を stdout ----------
  console.log(`\n=== [B] JobEntry 全件一覧（差分あり ${changed.length}件） ===`);
  console.log("candidateId, entryId, 会社名, jobDb: before→after, externalJobNo: before→after, jobType: before→after(reset)");
  for (const p of changed) {
    console.log(
      `  ${p.candidateId} ${p.id} "${p.companyName}" | jobDb: ${p.beforeJobDb ?? "null"} → ${p.afterJobDb} | jobNo: ${p.beforeJobNo ?? "null"} → ${p.afterJobNo ?? "null"} | jobType: ${p.beforeJobType ?? "null"} → ${p.afterJobType ?? "null"}${p.resetJobType ? " (reset)" : ""}`,
    );
  }

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 処理未実行。--execute を付けて再実行してください。)`);
    console.log(`  [A] CandidateFile 更新: ${filesToTouch.length}件`);
    console.log(`  [B] JobEntry 更新: ${changed.length}件（うち jobType リセット: ${resetCount}件）`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ---------- 実行 ----------
  console.log(`\n=== EXECUTE ===`);

  // (a) CandidateFile
  let filesOk = 0;
  let filesErr = 0;
  for (const f of filesToTouch) {
    try {
      await prisma.candidateFile.update({
        where: { id: f.id },
        data: { sourceMedia: TARGET_SOURCE_MEDIA },
      });
      filesOk++;
    } catch (e) {
      filesErr++;
      console.error(`  [A] update failed fileId=${f.id}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  [A] CandidateFile.sourceMedia 更新: 成功=${filesOk} / 失敗=${filesErr}`);

  // (b) JobEntry
  let entOk = 0;
  let entErr = 0;
  for (const p of changed) {
    try {
      await prisma.jobEntry.update({
        where: { id: p.id },
        data: {
          jobDb: p.afterJobDb,
          externalJobNo: p.afterJobNo ?? null,
          ...(p.resetJobType ? { jobType: null } : {}),
        },
      });
      entOk++;
    } catch (e) {
      entErr++;
      console.error(`  [B] update failed entryId=${p.id}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  [B] JobEntry 更新: 成功=${entOk} / 失敗=${entErr}（うち jobType リセット対象: ${resetCount}件）`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});

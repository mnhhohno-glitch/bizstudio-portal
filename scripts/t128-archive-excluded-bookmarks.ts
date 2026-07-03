/**
 * T-128 Phase3-b: 対象外（EXCLUDED）済み求人の残留ブックマーク掃除
 *
 * 全候補者について、EXCLUDED 求人に対応する BOOKMARK(archivedAt=null) を抽出し、
 * archivedAt を設定してお気に入りGETから外す（物理削除しない）。
 *
 * 突合キー: restore-jobs と同一（stripFileMetadata(fileName) === normalizeKyuujin(company_name)）。
 *
 * ★安全ルール（重要）★
 *   実データ調査で、多くの候補者は「同一会社が _No付き(EXCLUDED) と クリーン名(アクティブ) の
 *   重複求人」を持ち、ブックマークの正規化名はアクティブ側を指すことが判明。
 *   このため「EXCLUDEDにマッチ」だけでアーカイブすると、生きている求人（気になる含む）の
 *   ブックマークまで消してしまう。
 *   → アーカイブ対象は「正規化名が EXCLUDED 求人にマッチ、かつ 同名のアクティブ求人が存在しない」
 *      ブックマークのみ（＝真に対象外だけの残骸）。
 *   → 「EXCLUDEDにもアクティブにもマッチ（重複あり）」は AMBIGUOUS として報告のみ・触らない。
 *
 * Usage:
 *   npx tsx scripts/t128-archive-excluded-bookmarks.ts            # dry-run
 *   npx tsx scripts/t128-archive-excluded-bookmarks.ts --execute  # 実アーカイブ
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "fs";
import { stripFileMetadata } from "../src/lib/normalize-filename";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");
const KYUUJIN_URL =
  process.env.KYUUJIN_PDF_TOOL_URL ||
  process.env.KYUUJIN_API_URL ||
  "https://web-production-95808.up.railway.app";

function normalizeKyuujinCompanyName(name: string): string {
  return name.replace(/_\d{14,}$/, "").replace(/[：:]\d+$/, "").trim();
}

type JobInfo = { excludedNames: Set<string>; activeNames: Set<string> } | null;

async function fetchJobInfo(candidateNumber: string): Promise<JobInfo> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(
      `${KYUUJIN_URL}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
      { signal: controller.signal }
    ).finally(() => clearTimeout(timeout));
    if (!res.ok) return null;
    const data = await res.json();
    const jobs: { id: number; company_name?: string; feedback_status?: string }[] = data.jobs || [];
    const excludedNames = new Set<string>();
    const activeNames = new Set<string>();
    for (const j of jobs) {
      if (!j.company_name) continue;
      const n = normalizeKyuujinCompanyName(j.company_name);
      if ((j.feedback_status || "UNANSWERED") === "EXCLUDED") excludedNames.add(n);
      else activeNames.add(n);
    }
    return { excludedNames, activeNames };
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type ArchiveRow = {
  id: string;
  candidateId: string;
  candidateNumber: string;
  fileName: string;
  portalNorm: string;
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log(`[T128-3b] Mode: ${EXECUTE ? "EXECUTE (archive)" : "DRY-RUN"}`);
  console.log(`[T128-3b] kyuujin: ${KYUUJIN_URL}`);

  // 1. 全アクティブ BOOKMARK + candidateNumber
  const bookmarks = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", archivedAt: null },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      candidate: { select: { candidateNumber: true } },
    },
  });
  console.log(`[T128-3b] Total active BOOKMARK: ${bookmarks.length}`);

  // 2. 候補者ごとにグルーピング
  const byCandidate = new Map<string, typeof bookmarks>();
  for (const b of bookmarks) {
    const arr = byCandidate.get(b.candidateId) ?? [];
    arr.push(b);
    byCandidate.set(b.candidateId, arr);
  }
  const candidateIds = [...byCandidate.keys()];
  console.log(`[T128-3b] Distinct candidates with bookmarks: ${candidateIds.length}`);

  // 3. kyuujin job info を取得
  const infoByCandidate = new Map<string, JobInfo>();
  await mapLimit(candidateIds, 6, async (cid) => {
    const num = byCandidate.get(cid)![0].candidate?.candidateNumber ?? null;
    if (!num) { infoByCandidate.set(cid, null); return; }
    infoByCandidate.set(cid, await fetchJobInfo(num));
  });

  // 4. 分類
  const archive: ArchiveRow[] = [];       // EXCLUDEDのみ・アクティブ重複なし → 安全に archive
  const ambiguous: ArchiveRow[] = [];     // EXCLUDEDにもアクティブにもマッチ → 触らない（報告）
  let skippedNoToken = 0;
  let skippedFetchFail = 0;

  for (const cid of candidateIds) {
    const files = byCandidate.get(cid)!;
    const num = files[0].candidate?.candidateNumber ?? "";
    const info = infoByCandidate.get(cid);
    if (!info) {
      if (!num) skippedNoToken++; else skippedFetchFail++;
      continue;
    }
    for (const f of files) {
      const pn = stripFileMetadata(f.fileName);
      const inExcluded = info.excludedNames.has(pn);
      const inActive = info.activeNames.has(pn);
      if (inExcluded && !inActive) {
        archive.push({ id: f.id, candidateId: cid, candidateNumber: num, fileName: f.fileName, portalNorm: pn });
      } else if (inExcluded && inActive) {
        ambiguous.push({ id: f.id, candidateId: cid, candidateNumber: num, fileName: f.fileName, portalNorm: pn });
      }
    }
  }

  const archiveCandidates = new Set(archive.map((a) => a.candidateId)).size;

  console.log("");
  console.log("=== 3-b 結果 ===");
  console.log(`  archive対象（EXCLUDEDのみ・重複なし）: ${archive.length} 件 / ${archiveCandidates} 候補者`);
  console.log(`  ambiguous（重複あり・触らない）        : ${ambiguous.length} 件`);
  console.log(`  skip: token無し=${skippedNoToken} / fetch失敗=${skippedFetchFail}`);

  // 5008089 検証
  const t89a = archive.filter((a) => a.candidateNumber === "5008089");
  const t89amb = ambiguous.filter((a) => a.candidateNumber === "5008089");
  console.log(`  [検証] 5008089: archive=${t89a.length} / ambiguous=${t89amb.length}`);

  // 5. rollback CSV
  const stamp = "2026-07-03";
  const csvPath = `verify/t128-excluded-bookmarks-rollback-${stamp}.csv`;
  const header = "id,candidate_id,candidate_number,file_name,portal_norm,prev_archived_at";
  const lines = [header, ...archive.map((a) =>
    [a.id, a.candidateId, a.candidateNumber, a.fileName, a.portalNorm, ""].map(csvEscape).join(",")
  )];
  writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  console.log(`  rollback CSV: ${csvPath}（${archive.length} 行）`);

  // ambiguous も監査用に出す
  const ambPath = `verify/t128-excluded-bookmarks-ambiguous-${stamp}.csv`;
  const alines = [header.replace(",prev_archived_at", ""), ...ambiguous.map((a) =>
    [a.id, a.candidateId, a.candidateNumber, a.fileName, a.portalNorm].map(csvEscape).join(",")
  )];
  writeFileSync(ambPath, alines.join("\n") + "\n", "utf8");
  console.log(`  ambiguous CSV: ${ambPath}（${ambiguous.length} 行・触らない）`);

  // 6. 実アーカイブ（ID限定）
  if (EXECUTE) {
    const ids = archive.map((a) => a.id);
    console.log("");
    console.log(`[T128-3b] EXECUTE: ${ids.length} 件を ID 限定で archive します...`);
    let updated = 0;
    const BATCH = 200;
    const now = new Date();
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const r = await prisma.candidateFile.updateMany({
        where: { id: { in: batch }, archivedAt: null },
        data: { archivedAt: now, archivedReason: "job-excluded-sync" },
      });
      updated += r.count;
    }
    console.log(`[T128-3b] archive完了: ${updated} 件（対象 ${ids.length} 件）`);
    if (updated !== ids.length) console.warn(`[T128-3b] ⚠ 更新数と対象数が不一致（並行更新の可能性）`);
  } else {
    console.log("");
    console.log("[T128-3b] DRY-RUN のため archive は行っていません。--execute で実行。");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

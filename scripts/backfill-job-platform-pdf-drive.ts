/**
 * D-3 遡り: 既存の求人検索由来ブックマーク（CandidateFile・sourceType="job-platform"・driveFileId=null）に
 * pdf-service でPDFを生成 → 既存の Google Drive 保管プラミングで求職者フォルダへ保管 →
 * driveFileId/driveViewUrl/driveFolderId/mimeType/fileSize を更新する一回限りの移行スクリプト。
 *
 * 対象: 佐藤梓(5007911)・中山ちはる(5008117) の driveFileId=null 行（D-3本体 11bd630 適用前の保存分）。
 * 冪等（driveFileId 済みは再生成しない）・失敗隔離（行単位）・既存PDF行(sourceType=null)非干渉。
 *
 * ⚠️ 要環境変数（本番Railwayにのみ存在・ローカル.envには無い）:
 *   GOOGLE_SERVICE_ACCOUNT_KEY（Drive認証）/ GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID（既存フォルダ再利用時は不要）/ DATABASE_URL
 * 実行（本番コンテナ上）:
 *   railway ssh  → 　npx tsx scripts/backfill-job-platform-pdf-drive.ts            # DRY-RUN
 *                    npx tsx scripts/backfill-job-platform-pdf-drive.ts --execute  # 本実行
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { uploadFileToDrive, getOrCreateFolder } from "../src/lib/google-drive";
import * as fs from "fs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || "https://bizstudio-job-platform-production.up.railway.app";
const EXECUTE = process.argv.includes("--execute");

async function genPdf(sid: string): Promise<Buffer> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 40000);
  try {
    const res = await fetch(`${PDF_SERVICE_URL}/generate?sid=${encodeURIComponent(sid)}`, {
      signal: controller.signal, headers: { "User-Agent": "node" },
    });
    if (!res.ok) throw new Error(`pdf-service ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.subarray(0, 4).toString() !== "%PDF") throw new Error("not a PDF");
    return buf;
  } finally { clearTimeout(t); }
}

async function main() {
  const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID; // 無ければ既存フォルダ再利用
  const cands = await prisma.candidate.findMany({
    where: { candidateNumber: { in: ["5007911", "5008117"] } },
    select: { id: true, candidateNumber: true, name: true },
  });
  const ids = cands.map((c) => c.id);

  // 各候補者の既存 driveFolderId（既存ブックマークが使う求職者サブフォルダ）を解決＝同一場所に統一保管。
  // 親フォルダ env が無くても既存フォルダへ直接アップロードできる。
  const folderByCand = new Map<string, string>();
  for (const cid of ids) {
    const grp = await prisma.candidateFile.groupBy({
      by: ["driveFolderId"],
      where: { candidateId: cid, driveFolderId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { driveFolderId: "desc" } },
      take: 1,
    });
    if (grp[0]?.driveFolderId) folderByCand.set(cid, grp[0].driveFolderId);
  }
  const targets = await prisma.candidateFile.findMany({
    where: { candidateId: { in: ids }, category: "BOOKMARK", sourceType: "job-platform", driveFileId: null },
    select: { id: true, candidateId: true, fileName: true, externalJobRef: true },
    orderBy: [{ candidateId: "asc" }, { createdAt: "asc" }],
  });
  // safety: ensure no sourceType=null sneaks in (query already filters, double-check)
  const bad = await prisma.candidateFile.count({ where: { id: { in: targets.map(t=>t.id) }, sourceType: null } });
  const byCand: Record<string, number> = {};
  for (const t of targets) byCand[t.candidateId] = (byCand[t.candidateId] || 0) + 1;
  console.log(`=== 対象 ${targets.length}件 (mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}) ===`);
  for (const c of cands) console.log(`  ${c.candidateNumber} ${c.name}: ${byCand[c.id] || 0}件`);
  console.log(`  既存PDF行(sourceType=null)の混入: ${bad} (expect 0)`);

  if (!EXECUTE) {
    console.log("\n(DRY-RUN: 処理未実行)");
    for (const t of targets) console.log(`  ${t.externalJobRef}  ${t.fileName}`);
    await prisma.$disconnect(); await pool.end(); return;
  }

  const log: { id: string; candidateId: string; ref: string; driveFileId: string; ok: boolean; err?: string }[] = [];
  let ok = 0, ng = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.externalJobRef) { ng++; log.push({ id: t.id, candidateId: t.candidateId, ref: "", driveFileId: "", ok: false, err: "no externalJobRef" }); continue; }
    // idempotent re-check
    const cur = await prisma.candidateFile.findUnique({ where: { id: t.id }, select: { driveFileId: true } });
    if (cur?.driveFileId) { console.log(`  [${i+1}/${targets.length}] skip (already has driveFileId): ${t.fileName}`); log.push({ id: t.id, candidateId: t.candidateId, ref: t.externalJobRef, driveFileId: cur.driveFileId, ok: true, err: "skipped(idempotent)" }); ok++; continue; }
    try {
      const pdf = await genPdf(t.externalJobRef);
      // 既存の求職者フォルダを優先（統一保管）。無ければ親env+getOrCreateFolderで作成。
      let folderId = folderByCand.get(t.candidateId);
      if (!folderId) {
        if (!parentFolderId) throw new Error("既存folderも親env(GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID)も無くフォルダ解決不可");
        folderId = await getOrCreateFolder(t.candidateId, parentFolderId);
        folderByCand.set(t.candidateId, folderId);
      }
      const { fileId, webViewLink } = await uploadFileToDrive(t.fileName, pdf, folderId, "application/pdf");
      await prisma.candidateFile.update({
        where: { id: t.id },
        data: { driveFileId: fileId, driveViewUrl: webViewLink, driveFolderId: folderId, mimeType: "application/pdf", fileSize: pdf.length },
      });
      ok++; log.push({ id: t.id, candidateId: t.candidateId, ref: t.externalJobRef, driveFileId: fileId, ok: true });
      console.log(`  [${i+1}/${targets.length}] OK ${t.fileName} (${pdf.length}B) -> ${fileId}`);
    } catch (e) {
      ng++; const msg = e instanceof Error ? e.message : String(e);
      log.push({ id: t.id, candidateId: t.candidateId, ref: t.externalJobRef, driveFileId: "", ok: false, err: msg });
      console.log(`  [${i+1}/${targets.length}] FAIL ${t.fileName}: ${msg}`);
    }
  }
  const csv = "id,candidateId,externalJobRef,driveFileId,ok,err\n" + log.map(l => `${l.id},${l.candidateId},${l.ref},${l.driveFileId},${l.ok},"${l.err||""}"`).join("\n") + "\n";
  fs.writeFileSync("verify/job-platform-pdf-backfill-20260629.csv", csv, "utf8");
  console.log(`\n=== 成功 ${ok} / 失敗 ${ng} / 計 ${targets.length} ===`);
  console.log("CSV: verify/job-platform-pdf-backfill-20260629.csv");
  await prisma.$disconnect(); await pool.end();
}
main().catch(async (e) => { console.error("ERR", e instanceof Error ? e.message : String(e)); await pool.end(); process.exit(1); });

/**
 * T-181 遡り: PDF実体の無いブックマーク行（CandidateFile・category="BOOKMARK"・driveFileId=null・
 * externalJobRef あり）に pdf-service でPDFを生成 → 既存の Google Drive 保管プラミングで
 * 求職者フォルダへ保管 → driveFileId/driveViewUrl/driveFolderId/mimeType/fileSize を更新し、
 * OneDrive コピー（runOneDriveSyncForFile）も起動する一回限りの移行スクリプト。
 *
 * 対象（origin 不問）:
 *   - サイト経由（origin="candidate"）でPDF未生成の行（T-181 本体適用前の保存分）
 *   - CA登録（from-job-platform）だがPDF生成に失敗していた行
 *   ※ アーカイブ済み（archivedAt 非NULL）は対象外。externalJobRef 無し（kyuujin求人由来）も対象外。
 *
 * 安全装置:
 *   - where で driveFileId=null に限定 + 実行直前に行単位で再確認（既存PDF行は絶対に触らない）
 *   - 冪等（driveFileId 済みは skip）・失敗隔離（行単位）・失敗/スキップは CSV に出力
 *
 * ⚠️ 要環境変数（本番Railwayにのみ存在・ローカル.envには無い）:
 *   GOOGLE_SERVICE_ACCOUNT_KEY（Drive認証）/ GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID（既存フォルダ再利用時は不要）/ DATABASE_URL
 * 実行（本番コンテナ上）:
 *   railway ssh  → 　npx tsx scripts/backfill-job-platform-pdf-drive.ts            # DRY-RUN
 *                    npx tsx scripts/backfill-job-platform-pdf-drive.ts --execute  # 本実行
 *
 * （旧版 D-3 遡り〔2026-06-29・特定2候補者のみ〕を T-181 で全件対象に差し替え）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { uploadFileToDrive, getOrCreateFolder } from "../src/lib/google-drive";
import { runOneDriveSyncForFile } from "../src/lib/onedrive-sync";
import * as fs from "fs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || "https://bizstudio-job-platform-production.up.railway.app";
const EXECUTE = process.argv.includes("--execute");
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, "");

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

  const targets = await prisma.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      driveFileId: null,
      externalJobRef: { not: null },
      archivedAt: null,
    },
    select: { id: true, candidateId: true, fileName: true, externalJobRef: true, origin: true },
    orderBy: [{ candidateId: "asc" }, { createdAt: "asc" }],
  });

  // 対象候補者の既存 driveFolderId（既存ブックマークが使う求職者サブフォルダ）を解決＝同一場所に統一保管。
  const candIds = [...new Set(targets.map((t) => t.candidateId))];
  const cands = await prisma.candidate.findMany({
    where: { id: { in: candIds } },
    select: { id: true, candidateNumber: true, name: true },
  });
  const candById = new Map(cands.map((c) => [c.id, c]));
  const folderByCand = new Map<string, string>();
  for (const cid of candIds) {
    const grp = await prisma.candidateFile.groupBy({
      by: ["driveFolderId"],
      where: { candidateId: cid, driveFolderId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { driveFolderId: "desc" } },
      take: 1,
    });
    if (grp[0]?.driveFolderId) folderByCand.set(cid, grp[0].driveFolderId);
  }

  const byOrigin: Record<string, number> = {};
  for (const t of targets) byOrigin[t.origin ?? "(null=ca)"] = (byOrigin[t.origin ?? "(null=ca)"] || 0) + 1;
  console.log(`=== 対象 ${targets.length}件・候補者 ${candIds.length}名 (mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}) ===`);
  console.log(`  origin内訳: ${JSON.stringify(byOrigin)}`);
  for (const c of cands) {
    const n = targets.filter((t) => t.candidateId === c.id).length;
    console.log(`  ${c.candidateNumber} ${c.name}: ${n}件`);
  }

  if (!EXECUTE) {
    console.log("\n(DRY-RUN: 処理未実行)");
    for (const t of targets) console.log(`  ${t.externalJobRef}  ${t.fileName}  origin=${t.origin ?? "ca"}`);
    await prisma.$disconnect(); await pool.end(); return;
  }

  const log: { id: string; candidateNumber: string; ref: string; driveFileId: string; ok: boolean; onedrive: string; err?: string }[] = [];
  let ok = 0, ng = 0, skip = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const candNo = candById.get(t.candidateId)?.candidateNumber ?? t.candidateId;
    if (!t.externalJobRef) { skip++; log.push({ id: t.id, candidateNumber: candNo, ref: "", driveFileId: "", ok: false, onedrive: "", err: "no externalJobRef" }); continue; }
    // 冪等・安全再確認: 既に driveFileId が付いた行は絶対に触らない
    const cur = await prisma.candidateFile.findUnique({ where: { id: t.id }, select: { driveFileId: true } });
    if (cur?.driveFileId) { console.log(`  [${i + 1}/${targets.length}] skip (already has driveFileId): ${t.fileName}`); log.push({ id: t.id, candidateNumber: candNo, ref: t.externalJobRef, driveFileId: cur.driveFileId, ok: true, onedrive: "", err: "skipped(idempotent)" }); skip++; continue; }
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
      // T-181: OneDrive コピーも起動（既存CA登録行と同じ扱いに揃える）。本文は手元にあるので取り直さない。
      // runOneDriveSyncForFile は例外を投げない設計（結果は OneDriveSyncLog に記録される）。
      const od = await runOneDriveSyncForFile({ candidateFileId: t.id, content: pdf, mimeType: "application/pdf" });
      ok++; log.push({ id: t.id, candidateNumber: candNo, ref: t.externalJobRef, driveFileId: fileId, ok: true, onedrive: `${od.status}${od.skipReason ? `(${od.skipReason})` : ""}` });
      console.log(`  [${i + 1}/${targets.length}] OK ${t.fileName} (${pdf.length}B) -> ${fileId} onedrive=${od.status}`);
    } catch (e) {
      ng++; const msg = e instanceof Error ? e.message : String(e);
      log.push({ id: t.id, candidateNumber: candNo, ref: t.externalJobRef, driveFileId: "", ok: false, onedrive: "", err: msg });
      console.log(`  [${i + 1}/${targets.length}] FAIL ${t.fileName}: ${msg}`);
    }
  }
  const csvPath = `verify/t181-pdf-backfill-${STAMP}.csv`;
  const csv = "id,candidateNumber,externalJobRef,driveFileId,ok,onedrive,err\n" + log.map((l) => `${l.id},${l.candidateNumber},${l.ref},${l.driveFileId},${l.ok},${l.onedrive},"${l.err || ""}"`).join("\n") + "\n";
  fs.writeFileSync(csvPath, csv, "utf8");
  console.log(`\n=== 成功 ${ok} / 失敗 ${ng} / スキップ ${skip} / 計 ${targets.length} ===`);
  console.log(`CSV: ${csvPath}`);
  await prisma.$disconnect(); await pool.end();
}
main().catch(async (e) => { console.error("ERR", e instanceof Error ? e.message : String(e)); await pool.end(); process.exit(1); });

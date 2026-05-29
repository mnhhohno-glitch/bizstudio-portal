/**
 * T-067 Phase 5: 面談添付の二重管理統合 — データ移行スクリプト
 *
 * InterviewAttachment（Supabase Storage バケット `interview-attachments`）にある全ファイルを、
 * 当該面談の candidateId 配下の CandidateFile（category=MEETING, Google Drive）へ移行する。
 *
 * 仕様:
 * - 解析結果（analysisResult / analysisStatus / analyzedAt）は移行しない
 *   （candidate-intake 側で再解析可能、かつ CandidateFile スキーマに対応カラム無し）
 * - 元の InterviewAttachment レコード・Supabase ファイルは削除しない（凍結）
 * - idempotent: 同一 candidateId に同名・同サイズの CandidateFile(MEETING) が既存ならスキップ
 *
 * 使い方:
 *   dry-run:  npx tsx scripts/migrate-interview-attachments-to-candidate-files.ts --dry-run
 *   本番実行:  npx tsx scripts/migrate-interview-attachments-to-candidate-files.ts --execute
 *
 * 事前確認クエリ（規模把握用、実行は手動）:
 *   SELECT ir.candidate_id,
 *          (SELECT COUNT(*) FROM interview_attachments ia
 *           JOIN interview_records ir2 ON ir2.id = ia.interview_record_id
 *           WHERE ir2.candidate_id = ir.candidate_id) AS att_count,
 *          (SELECT COUNT(*) FROM candidate_files cf
 *           WHERE cf.candidate_id = ir.candidate_id AND cf.category = 'MEETING') AS cf_meeting_count
 *   FROM interview_records ir
 *   GROUP BY ir.candidate_id
 *   HAVING att_count > 0 OR cf_meeting_count > 0;
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BUCKET = "interview-attachments";
const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;

type Stat = {
  total: number;
  skippedExisting: number;
  skippedNoCandidate: number;
  succeeded: number;
  failed: number;
};

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isExecute = args.includes("--execute");

  if (!isDryRun && !isExecute) {
    console.error("Usage: --dry-run | --execute");
    process.exit(1);
  }

  // execute 時のみ Supabase / Drive を初期化（dry-run では DB しか触らない）
  let supabase: SupabaseClient | null = null;
  let uploadFileToDrive: typeof import("../src/lib/google-drive").uploadFileToDrive | null = null;
  let getOrCreateFolder: typeof import("../src/lib/google-drive").getOrCreateFolder | null = null;

  if (isExecute) {
    if (!PARENT_FOLDER_ID) {
      console.error("GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID が設定されていません（--execute には必須）");
      process.exit(1);
    }
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません（--execute には必須）");
      process.exit(1);
    }
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const drive = await import("../src/lib/google-drive");
    uploadFileToDrive = drive.uploadFileToDrive;
    getOrCreateFolder = drive.getOrCreateFolder;
  }

  // 一括取得して逐次処理
  const attachments = await prisma.interviewAttachment.findMany({
    include: {
      interview: { select: { candidateId: true } },
    },
    orderBy: { uploadedAt: "asc" },
  });

  console.log(`\n対象 InterviewAttachment: ${attachments.length} 件`);
  console.log(`モード: ${isDryRun ? "dry-run" : "execute"}\n`);

  // 移行担当ユーザー（uploadedByUserId 必須カラム対応）。
  // 既存運用に倣い、最初の admin ユーザーを取得して固定する。
  let systemUserId: string | null = null;
  if (isExecute) {
    const adminUser = await prisma.user.findFirst({
      where: { role: "admin" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!adminUser) {
      console.error("admin ユーザーが見つかりません。uploadedByUserId に使う User が必要です。");
      process.exit(1);
    }
    systemUserId = adminUser.id;
    console.log(`uploadedByUserId として使用するユーザー: ${systemUserId}\n`);
  }

  const stat: Stat = {
    total: attachments.length,
    skippedExisting: 0,
    skippedNoCandidate: 0,
    succeeded: 0,
    failed: 0,
  };

  // candidateId → Drive フォルダ ID のキャッシュ（同一求職者の複数ファイルで重複作成を防ぐ）
  const driveFolderCache = new Map<string, string>();

  let idx = 0;
  for (const att of attachments) {
    idx++;
    const prefix = `[${idx}/${stat.total}] att=${att.id} file=${att.fileName}`;

    const candidateId = att.interview?.candidateId;
    if (!candidateId) {
      console.warn(`${prefix} SKIP: 親 InterviewRecord に candidateId が無い`);
      stat.skippedNoCandidate++;
      continue;
    }

    // idempotent: 同一 candidateId に同名・同サイズの MEETING ファイルが存在すればスキップ
    const existing = await prisma.candidateFile.findFirst({
      where: {
        candidateId,
        category: "MEETING",
        fileName: att.fileName,
        fileSize: att.fileSize,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`${prefix} SKIP: CandidateFile 既存 (id=${existing.id})`);
      stat.skippedExisting++;
      continue;
    }

    if (isDryRun) {
      console.log(`${prefix} WILL MIGRATE: candidate=${candidateId}, size=${att.fileSize}, mime=${att.mimeType}`);
      stat.succeeded++;
      continue;
    }

    // execute モード
    try {
      // 1. Supabase から実体ダウンロード
      const { data: fileData, error: downloadError } = await supabase!.storage
        .from(BUCKET)
        .download(att.filePath);
      if (downloadError || !fileData) {
        throw new Error(`Supabase download failed: ${downloadError?.message ?? "no data"}`);
      }
      const buffer = Buffer.from(await fileData.arrayBuffer());

      // 2. Drive 求職者フォルダを取得 or 作成（キャッシュ利用）
      let folderId = driveFolderCache.get(candidateId);
      if (!folderId) {
        folderId = await getOrCreateFolder!(candidateId, PARENT_FOLDER_ID!);
        driveFolderCache.set(candidateId, folderId);
      }

      // 3. Drive にアップロード
      const mimeType = att.mimeType || "application/octet-stream";
      const { fileId, webViewLink } = await uploadFileToDrive!(
        att.fileName,
        buffer,
        folderId,
        mimeType,
      );

      // 4. CandidateFile レコード作成
      const cf = await prisma.candidateFile.create({
        data: {
          candidateId,
          category: "MEETING",
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType,
          driveFileId: fileId,
          driveViewUrl: webViewLink,
          driveFolderId: folderId,
          memo: att.memo,
          uploadedByUserId: systemUserId!,
        },
        select: { id: true },
      });

      console.log(`${prefix} OK: created CandidateFile id=${cf.id}`);
      stat.succeeded++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${prefix} FAIL: ${msg}`);
      stat.failed++;
    }
  }

  console.log("\n========== 集計 ==========");
  console.log(`総数:               ${stat.total}`);
  console.log(`移行成功:           ${stat.succeeded}${isDryRun ? "（dry-run 上での見積もり）" : ""}`);
  console.log(`スキップ（既存）:    ${stat.skippedExisting}`);
  console.log(`スキップ（親なし）:  ${stat.skippedNoCandidate}`);
  console.log(`失敗:               ${stat.failed}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});

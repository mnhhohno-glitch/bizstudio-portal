import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";

// D-3: 求人検索由来PDFの生成元（Railway pdf-service）。本番は環境変数で上書き可。
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || "https://bizstudio-job-platform-production.up.railway.app";
const PDF_GEN_TIMEOUT_MS = 30000;

/**
 * D-3: pdf-service でPDFを生成 → 既存のGoogle Drive保管プラミングで求職者フォルダへ保管
 *      → CandidateFile の driveFileId/driveViewUrl/driveFolderId/mimeType/fileSize を更新。
 * 失敗時は throw（呼び出し側で try/catch 隔離＝保存自体は巻き込まない）。extractedText は触らない。
 */
async function generateAndStorePdf(params: {
  fileId: string;
  candidateId: string;
  sid: string;
  fileName: string;
}): Promise<void> {
  const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
  if (!parentFolderId) throw new Error("GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID 未設定");

  // 1) pdf-service からPDFバイナリ取得（タイムアウト付き）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_GEN_TIMEOUT_MS);
  let pdfBuffer: Buffer;
  try {
    const token = process.env.PDF_SERVICE_TOKEN; // 将来用・設定時のみ送信（現状 /generate は未要求）
    const res = await fetch(`${PDF_SERVICE_URL}/generate?sid=${encodeURIComponent(params.sid)}`, {
      signal: controller.signal,
      ...(token ? { headers: { "x-api-token": token } } : {}),
    });
    if (!res.ok) throw new Error(`pdf-service responded ${res.status}`);
    pdfBuffer = Buffer.from(await res.arrayBuffer());
    if (pdfBuffer.length === 0) throw new Error("pdf-service returned empty body");
  } finally {
    clearTimeout(timer);
  }

  // 2) 既存の保管プラミングで求職者フォルダ（candidateId 名）へアップロード（既存ブックマークと同一場所）
  const folderId = await getOrCreateFolder(params.candidateId, parentFolderId);
  const { fileId: driveFileId, webViewLink } = await uploadFileToDrive(params.fileName, pdfBuffer, folderId, "application/pdf");

  // 3) CandidateFile を更新（fileName/extractedText/sourceType 等は維持・PDF実体情報のみ追加）
  await prisma.candidateFile.update({
    where: { id: params.fileId },
    data: {
      driveFileId,
      driveViewUrl: webViewLink,
      driveFolderId: folderId,
      mimeType: "application/pdf",
      fileSize: pdfBuffer.length,
    },
  });
}

/**
 * POST /api/external/bookmarks/from-job-platform
 * 案Z 段階B：job-platform(別システムの求人検索)で見つけた求人を、指定求職者の
 * 既存ブックマーク（CandidateFile・category="BOOKMARK"）として Drive 実体なしで直接保存する。
 * これにより既存 AI 評価（analyze-batch・extractedText のみ参照）に無改修で乗る。
 *
 * - 認証: x-api-secret（JOB_PLATFORM_API_SECRET）。saved-jobs と同一。
 * - 保存者: body.savedByUserId（job-platform が portal SSO で得た User.id）が実在＆active なら
 *   uploadedByUserId に採用（担当列に本人名表示）。無い/不正は anonymous@local にフォールバック（後方互換）。
 * - extractedText（求人本文）必須。空は 400（AI評価対象外＝主目的未達のため）。
 * - fileName = 求人票_{会社名}_{10桁以上の数値ID}.pdf（数値ID無ければ 求人票_{会社名}.pdf）。
 *   ※ extractSearchNames p1（数値ID 10桁以上を末尾除去）/ p4（ID無し）で会社名を抽出。
 * - sourceType="job-platform"・externalJobRef=求人ID・driveFileId/driveViewUrl=null。
 * - lastExportedAt は立てない（配信ではないため weeklyMatrix 提案集計に乗せない・DECISION）。
 * - 冪等: 同一 candidateId × externalJobRef の既存 job-platform BOOKMARK 行があれば
 *   作成せずスナップショット（extractedText/fileName/memo）を更新（重複作成しない）。
 * - 一括対応: jobs[] で 複数求人 × 1求職者。単一は top-level でも可。
 */

type JobInput = {
  externalJobRef?: unknown;
  companyName?: unknown;
  jobTitle?: unknown;
  extractedText?: unknown;
  jobUrl?: unknown;
  fileNumericId?: unknown; // ファイル名用の数値ID（10桁以上推奨）。無ければ会社名のみ。
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// ファイル名の数値ID：fileNumericId が 10桁以上の数字ならそれ、
// 無ければ externalJobRef 内の 10桁以上連続数字、無ければ null（会社名のみのファイル名）。
function pickNumericId(fileNumericId: string | null, externalJobRef: string): string | null {
  if (fileNumericId && /^\d{10,}$/.test(fileNumericId)) return fileNumericId;
  const m = externalJobRef.match(/\d{10,}/);
  return m ? m[0] : null;
}

// 求人票_{会社名}_{数値ID}.pdf（数値ID無ければ 求人票_{会社名}.pdf）。
// ファイル名に使えない文字・区切り崩れ防止のためスラッシュ等は除去。
function buildFileName(companyName: string, numericId: string | null): string {
  const safe = companyName.replace(/[\\/:*?"<>|]/g, "").trim();
  return numericId ? `求人票_${safe}_${numericId}.pdf` : `求人票_${safe}.pdf`;
}

async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" }, select: { id: true } });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, select: { id: true } });
  return admin?.id ?? null;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 求職者キー: candidateId（cuid）優先、無ければ candidateNumber。
  const candidateIdRaw = str(body.candidateId);
  const candidateNumberRaw = str(body.candidateNumber);
  const key = candidateIdRaw ?? candidateNumberRaw;
  if (!key) {
    return NextResponse.json({ error: "candidateNumber or candidateId is required" }, { status: 400 });
  }
  const candidate = await prisma.candidate.findFirst({
    where: candidateIdRaw
      ? { id: candidateIdRaw }
      : key.startsWith("cm")
        ? { id: key }
        : { candidateNumber: key },
    select: { id: true, candidateNumber: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    return NextResponse.json({ error: "System user not found" }, { status: 500 });
  }

  // 保存者本人（job-platform が portal SSO で取得した User.id）。実在＆status=active のみ採用。
  // 無い/不正/非active は従来どおりシステムユーザー(anonymous@local)へフォールバック（後方互換）。
  let uploaderUserId = systemUserId;
  let savedBy: string | null = null;
  const savedByUserId = str(body.savedByUserId);
  if (savedByUserId) {
    const u = await prisma.user.findUnique({ where: { id: savedByUserId }, select: { id: true, status: true } });
    if (u && u.status === "active") {
      uploaderUserId = u.id;
      savedBy = u.id;
    }
  }

  const rawJobs: JobInput[] = Array.isArray(body.jobs) ? (body.jobs as JobInput[]) : [body as JobInput];

  let created = 0;
  let updated = 0;
  let pdfStored = 0;
  let pdfFailed = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < rawJobs.length; i++) {
    const j = rawJobs[i] ?? {};
    const externalJobRef = str(j.externalJobRef);
    const companyName = str(j.companyName);
    const extractedText = str(j.extractedText);
    if (!externalJobRef || !companyName) {
      errors.push({ index: i, error: "externalJobRef and companyName are required" });
      continue;
    }
    if (!extractedText) {
      errors.push({ index: i, error: "extractedText (job body) is required and must be non-empty" });
      continue;
    }

    const numericId = pickNumericId(str(j.fileNumericId), externalJobRef);
    const fileName = buildFileName(companyName, numericId);
    const memo = str(j.jobUrl); // UI 段階Dで求人URLを表示する用（任意）
    const fileSize = Buffer.byteLength(extractedText, "utf8");

    try {
      // 冪等: 同一求職者×同一求人（job-platform）の既存BOOKMARK行を探す。
      const existing = await prisma.candidateFile.findFirst({
        where: {
          candidateId: candidate.id,
          category: "BOOKMARK",
          sourceType: "job-platform",
          externalJobRef,
          archivedAt: null,
        },
        select: { id: true, extractedAt: true, driveFileId: true },
      });
      let fileId: string;
      let needsPdf: boolean; // driveFileId が未設定の行だけPDF生成（冪等・重複生成しない）
      if (existing) {
        // スナップショット更新（重複作成しない）。AI評価結果(aiMatchRating等)は触らない。
        // 保存者が明示された場合のみ uploadedByUserId も是正（既存Anonymous行の担当を本人に更新可能）。
        // extractedAt は「テキスト化済み」シグナル（AI分析フィルタが参照）。未設定なら立てる（既存値は維持）。
        await prisma.candidateFile.update({
          where: { id: existing.id },
          data: {
            fileName, fileSize, extractedText, memo,
            ...(existing.extractedAt ? {} : { extractedAt: new Date() }),
            ...(savedBy ? { uploadedByUserId: savedBy } : {}),
          },
        });
        updated++;
        fileId = existing.id;
        needsPdf = !existing.driveFileId; // 既にPDF保管済みなら再生成しない
      } else {
        const createdRow = await prisma.candidateFile.create({
          data: {
            candidateId: candidate.id,
            category: "BOOKMARK",
            fileName,
            fileSize,
            mimeType: "text/plain",
            driveFileId: null,
            driveViewUrl: null,
            driveFolderId: null,
            extractedText,
            // テキスト化済みシグナル: 保存時点で求人本文を受領済み＝AI分析フィルタ(extractedAt必須)を通すため立てる。
            extractedAt: new Date(),
            sourceType: "job-platform",
            externalJobRef,
            memo,
            uploadedByUserId: uploaderUserId,
          },
          select: { id: true },
        });
        created++;
        fileId = createdRow.id;
        needsPdf = true;
      }

      // D-3: PDF生成→Drive保管→URL埋め（driveFileId未設定の行のみ・冪等）。
      // 失敗しても保存(CandidateFile作成/更新)は成功扱いのまま（PDFは後で再生成可能）＝失敗隔離。
      if (needsPdf) {
        try {
          await generateAndStorePdf({ fileId, candidateId: candidate.id, sid: externalJobRef, fileName });
          pdfStored++;
        } catch (pdfErr) {
          console.error(`[external/bookmarks/from-job-platform] PDF gen/store failed (sid=${externalJobRef}):`, pdfErr instanceof Error ? pdfErr.message : String(pdfErr));
          pdfFailed++;
        }
      }
    } catch (e) {
      console.error("[external/bookmarks/from-job-platform] save failed:", e);
      errors.push({ index: i, error: "save failed" });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    candidateNumber: candidate.candidateNumber,
    received: rawJobs.length,
    created,
    updated, // 既存と同一求人の再保存（冪等・スナップショット更新）
    skipped: errors.length,
    pdfStored,  // D-3: PDF生成→Drive保管に成功した数
    pdfFailed,  // D-3: PDF生成/保管に失敗した数（保存自体は成功・後で再生成可）
    errors,
  });
}

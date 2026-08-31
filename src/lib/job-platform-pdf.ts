// T-181: 求人検索由来PDF（pdf-service 生成 → Google Drive 保管）の共通処理。
// 元は /api/external/bookmarks/from-job-platform 内のローカル関数（D-3）。
// サイト経由お気に入り（/api/external/candidate-site/favorites）とバックフィルでも
// 同一処理を使うため切り出した。挙動は切り出し前と同一。
import { prisma } from "@/lib/prisma";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";

// D-3: 求人検索由来PDFの生成元（Railway pdf-service）。本番は環境変数で上書き可。
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || "https://bizstudio-job-platform-production.up.railway.app";
const PDF_GEN_TIMEOUT_MS = 30000;

/**
 * D-3: pdf-service でPDFを生成 → 既存のGoogle Drive保管プラミングで求職者フォルダへ保管
 *      → CandidateFile の driveFileId/driveViewUrl/driveFolderId/mimeType/fileSize を更新。
 * 失敗時は throw（呼び出し側で try/catch 隔離＝保存自体は巻き込まない）。extractedText は触らない。
 *
 * T-159: 生成した PDF 本体を返す。呼び出し側が OneDrive へのコピーにそのまま渡し、
 *        Google Drive から取り直す往復を省くため。
 */
export async function generateAndStorePdf(params: {
  fileId: string;
  candidateId: string;
  sid: string;
  fileName: string;
}): Promise<Buffer> {
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

  return pdfBuffer;
}

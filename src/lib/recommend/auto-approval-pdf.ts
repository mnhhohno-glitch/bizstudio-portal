// T-189 Phase3-1: 自動配信行の承認時 PDF 生成（＋OneDrive コピー）。
// 自動由来行は受け口（from-job-platform の auto 分岐）でPDFを作らず、承認された求人だけここで作る
// （却下される求人の分まで pdf-service / Drive を消費しないため）。
// 失敗しても承認自体は巻き込まない（呼び出し側で結果を返し、カードの「PDF再生成」で再試行）。
import { prisma } from "@/lib/prisma";
import { generateAndStorePdf } from "@/lib/job-platform-pdf";
import { enqueueOneDriveSync, triggerOneDriveSync } from "@/lib/onedrive-sync";

export type AutoPdfResult = { fileId: string; ok: boolean; error?: string };

export async function generatePdfForAutoFile(file: {
  id: string;
  candidateId: string;
  externalJobRef: string | null;
  fileName: string;
  driveFileId: string | null;
}): Promise<AutoPdfResult> {
  if (file.driveFileId) return { fileId: file.id, ok: true }; // 既にPDFあり（冪等）
  if (!file.externalJobRef) return { fileId: file.id, ok: false, error: "externalJobRef が無いためPDFを生成できません" };
  try {
    // 受け口の手動経路と同じ順序: OneDrive 台帳を PENDING で用意 → PDF 生成/Drive 保管 → コピー起動（await しない）
    await enqueueOneDriveSync({ candidateFileId: file.id, candidateId: file.candidateId, category: "BOOKMARK" });
    const pdfBuffer = await generateAndStorePdf({
      fileId: file.id,
      candidateId: file.candidateId,
      sid: file.externalJobRef,
      fileName: file.fileName,
    });
    triggerOneDriveSync({ candidateFileId: file.id, content: pdfBuffer, mimeType: "application/pdf" });
    return { fileId: file.id, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[auto-approval-pdf] PDF gen/store failed file=${file.id} sid=${file.externalJobRef}: ${msg}`);
    return { fileId: file.id, ok: false, error: msg };
  }
}

export const AUTO_FILE_PDF_SELECT = {
  id: true,
  candidateId: true,
  externalJobRef: true,
  fileName: true,
  driveFileId: true,
} as const;

/** 指定 id のうち自動由来行だけを PDF 生成に必要な列で取る */
export async function findAutoFilesForPdf(fileIds: string[]) {
  return prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, autoSourcedAt: { not: null } },
    select: AUTO_FILE_PDF_SELECT,
  });
}

import { findAutoFilesForPdf, generatePdfForAutoFile, type AutoPdfResult } from "./auto-approval-pdf";
import { prisma } from "@/lib/prisma";

// T-189 修正（2026-09-02）: 自動配信行（autoSourcedAt != null）は「紹介保留」と「却下」を同一に扱う。
//   - 却下（承認ページ✗ / 詳細タブ✗ / analyze-collect の評価D自動却下）→ approvalStatus=REJECTED と同時に
//     archivedAt/archivedReason/archivedById も立てて保留一覧へ入れる（既に保留中なら保留側は温存）。
//   - 紹介保留 API / 復元 API 側の同期は各 route で行う（archive: →REJECTED, restore: →PENDING）。
//   受け口 from-job-platform の冪等判定は自動配信行なら archivedAt を問わず「既存」とみなすため、
//   保留にしても同じ求人が再送されることはない。

/**
 * 自動配信行を却下する（PENDING の自動由来行のみ対象＝冪等）。
 * archivedById 未指定時は行の uploadedByUserId（= 受け口の sourcedBy 相当）を保留者にする。
 * @returns 却下した件数
 */
export async function rejectAutoFiles(opts: {
  fileIds: string[];
  rejectedReason: string;
  archivedById?: string | null;
  now?: Date;
}): Promise<number> {
  if (opts.fileIds.length === 0) return 0;
  const now = opts.now ?? new Date();
  const targets = await prisma.candidateFile.findMany({
    where: { id: { in: opts.fileIds }, autoSourcedAt: { not: null }, approvalStatus: "PENDING" },
    select: { id: true, archivedAt: true, uploadedByUserId: true },
  });
  if (targets.length === 0) return 0;
  await prisma.$transaction(
    targets.map((t) =>
      prisma.candidateFile.update({
        where: { id: t.id },
        data: {
          approvalStatus: "REJECTED",
          rejectedReason: opts.rejectedReason,
          ...(t.archivedAt
            ? {}
            : {
                archivedAt: now,
                archivedReason: opts.rejectedReason,
                archivedNote: null,
                archivedById: opts.archivedById ?? t.uploadedByUserId ?? null,
              }),
        },
      }),
    ),
  );
  return targets.length;
}

/**
 * 自動配信行を承認する（PENDING の自動由来行・保留中でない行のみ対象＝冪等）。
 * 承認ページ ✓（/api/admin/auto-recommend/approve）と求職者詳細の「紹介求人へ移動」/「求人出力へ送信」で共有する。
 *   - approvalStatus="APPROVED" と同時に introducedAt を立てる（null の行のみ）。lastExportedAt は触らない。
 *   - この時点で PDF を生成し Drive 保管＋OneDrive コピー（driveFileId が既にある行は生成しない＝二重生成なし）。
 *     PDF 失敗は承認を巻き込まない（pdfFailed を返す。承認ページの「PDF再生成」で再試行）。
 *   - supportSubStatus の自動再計算は呼ばない（自動配信は支援ステータスに影響させない）。
 * @returns approvedIds = 今回 PENDING → APPROVED にした行、pdfFailed = PDF 生成に失敗した行
 */
export async function approveAutoFiles(opts: {
  fileIds: string[];
  now?: Date;
}): Promise<{ approvedIds: string[]; pdfGenerated: number; pdfFailed: AutoPdfResult[] }> {
  if (opts.fileIds.length === 0) return { approvedIds: [], pdfGenerated: 0, pdfFailed: [] };
  const now = opts.now ?? new Date();
  // 承認対象を先に確定（PENDING の自動由来行だけ。保留中＝却下扱いなので対象にしない）
  const targets = await prisma.candidateFile.findMany({
    where: {
      id: { in: opts.fileIds },
      autoSourcedAt: { not: null },
      approvalStatus: "PENDING",
      archivedAt: null,
    },
    select: { id: true },
  });
  const approvedIds = targets.map((t) => t.id);
  if (approvedIds.length === 0) return { approvedIds, pdfGenerated: 0, pdfFailed: [] };

  await prisma.$transaction([
    prisma.candidateFile.updateMany({
      where: { id: { in: approvedIds }, approvalStatus: "PENDING" },
      data: { approvalStatus: "APPROVED" },
    }),
    prisma.candidateFile.updateMany({
      where: { id: { in: approvedIds }, introducedAt: null },
      data: { introducedAt: now },
    }),
  ]);

  // PDF 生成（driveFileId 無しだけ。評価回収時/クリック時に生成済みの行はスキップ）。1件ずつ・失敗隔離。
  const pdfResults: AutoPdfResult[] = [];
  for (const f of await findAutoFilesForPdf(approvedIds)) {
    if (f.driveFileId) continue;
    pdfResults.push(await generatePdfForAutoFile(f));
  }
  const pdfFailed = pdfResults.filter((r) => !r.ok);
  return { approvedIds, pdfGenerated: pdfResults.length - pdfFailed.length, pdfFailed };
}

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

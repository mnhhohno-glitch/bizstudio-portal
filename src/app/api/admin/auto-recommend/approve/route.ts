import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { findAutoFilesForPdf, generatePdfForAutoFile } from "@/lib/recommend/auto-approval-pdf";

// T-189 Phase3-1: ✓承認。
//   - 対象: 自動由来（autoSourcedAt != null）かつ PENDING の行のみ（他の状態は無視＝冪等）。
//   - approvalStatus="APPROVED" と同時に introducedAt を立てる（mark-introduced 相当。null の行のみ）。
//     lastExportedAt は触らない。実績集計は autoSourcedAt IS NULL で自動由来を除外しているので
//     introducedAt を立てても日報の紹介数・週次実績には乗らない。
//   - この時点で PDF を生成し Drive 保管＋OneDrive コピー（受け口では作っていない）。
//     PDF 失敗は承認を巻き込まない（pdfFailed を返し、カードの「PDF再生成」で再試行）。
//   - supportSubStatus の自動再計算は呼ばない（自動配信は支援ステータスに影響させない）。
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { fileIds?: unknown };
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (fileIds.length === 0) return NextResponse.json({ error: "fileIds は必須です" }, { status: 400 });

  try {
    const now = new Date();
    // 承認対象を先に確定（PENDING の自動由来行だけ）
    const targets = await prisma.candidateFile.findMany({
      // T-189 修正: 保留中（archivedAt 非null）は却下扱いなので承認対象にしない
      where: { id: { in: fileIds }, autoSourcedAt: { not: null }, approvalStatus: "PENDING", archivedAt: null },
      select: { id: true },
    });
    const targetIds = targets.map((t) => t.id);
    if (targetIds.length > 0) {
      await prisma.$transaction([
        prisma.candidateFile.updateMany({
          where: { id: { in: targetIds }, approvalStatus: "PENDING" },
          data: { approvalStatus: "APPROVED" },
        }),
        prisma.candidateFile.updateMany({
          where: { id: { in: targetIds }, introducedAt: null },
          data: { introducedAt: now },
        }),
      ]);
    }

    // PDF 生成（承認済みになった行のうち driveFileId 無し）。1件ずつ・失敗隔離。
    const pdfResults = [];
    for (const f of await findAutoFilesForPdf(targetIds)) {
      pdfResults.push(await generatePdfForAutoFile(f));
    }
    const pdfFailed = pdfResults.filter((r) => !r.ok);
    console.log(
      `[admin/auto-recommend/approve] by=${auth.user.id} files=${fileIds.length} approved=${targetIds.length} pdfOk=${pdfResults.length - pdfFailed.length} pdfFailed=${pdfFailed.length}`,
    );
    return NextResponse.json({
      ok: true,
      approved: targetIds.length,
      approvedIds: targetIds,
      pdfGenerated: pdfResults.length - pdfFailed.length,
      pdfFailed: pdfFailed.map((r) => ({ fileId: r.fileId, error: r.error })),
    });
  } catch (e) {
    console.error("[admin/auto-recommend/approve] failed:", e);
    return NextResponse.json({ error: "承認に失敗しました" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

// T-182 追補2: mark-introduced の逆操作。「ブックマークに戻す」（誤操作の巻き戻し用）。
// CandidateFile.introducedAt を null に戻すだけの最小構成。認証・対象判定は mark-introduced と同一。
// 戻すと紹介求人区分から消え、求職者サイトの表示条件（introducedAt あり OR origin=candidate）からも外れる。
//   ※ origin="candidate" 行は introducedAt を消してもサイトに残る（OR 条件・意図どおり）。
// 対象外（スキップ）:
//   - 出力済行（lastExportedAt != null）… introducedAt を消しても mark-introduced が再度立てられず
//     片道になるため触らない（mark-introduced が出力済行に introducedAt を立てないのと対称）。
//   - 未紹介行（introducedAt == null）… 冪等
export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds } = body as { fileIds?: string[] };

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ error: "fileIds は必須です" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  // 対象行の判定をサーバー側で厳格に行う（UI の選択ミスや古い画面からの id 混入を弾く）。
  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, candidateId, category: "BOOKMARK", archivedAt: null },
    select: { id: true, lastExportedAt: true, introducedAt: true },
  });

  const alreadyExported = files.filter((f) => f.lastExportedAt);
  const notIntroduced = files.filter((f) => !f.lastExportedAt && !f.introducedAt);
  const targets = files.filter((f) => !f.lastExportedAt && f.introducedAt);

  if (targets.length > 0) {
    await prisma.candidateFile.updateMany({
      where: { id: { in: targets.map((f) => f.id) } },
      data: { introducedAt: null },
    });
    try {
      await recalculateSubStatusIfAuto(candidateId);
    } catch (e) {
      console.error("[unmark-introduced] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json({
    reverted: targets.length,
    skippedExported: alreadyExported.length,
    skippedNotIntroduced: notIntroduced.length,
    rejected: fileIds.length - files.length,
  });
}

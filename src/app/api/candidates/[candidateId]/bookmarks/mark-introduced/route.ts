import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

// T-161: 求人票を出力せずにブックマークを「紹介済み」にする（R2）。
// CandidateFile.introducedAt を立てるだけで、kyuujin への送信・lastExportedAt の変更は一切行わない。
//   - lastExportedAt は「実際に求人ツールへ出力した」実測値（日報の選定率・週次実績の提案人数の分子）。
//     ここに流用すると人事評価の数字が水増しされるため絶対に触らない。
//   - introducedAt は既存では T-133 移行バッチ（出力済行のみ）が書くだけで、通常運用の書き込みは本APIが初。
//     実績集計（3-8）は COALESCE(lastExportedAt, introducedAt) を提案日時として使う。
// T-182 追補3: 出力済行（lastExportedAt != null）にも introducedAt を立てられるようにした。
//   unmark-introduced が出力済行も戻せるようになったため、戻した行を紹介求人区分へ復帰できないと
//   片道になる。lastExportedAt は従来どおり一切触らない（実績の分子は COALESCE で lastExportedAt 優先）。
// 対象外（スキップ）:
//   - サイト経由行（origin="candidate" / driveFileId=null）… 本人応募は CA紹介実績に数えない（R1）
//   - 紹介済み行（introducedAt != null）… 冪等
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
    select: { id: true, origin: true, driveFileId: true, introducedAt: true },
  });

  const siteRows = files.filter((f) => f.origin === "candidate" && !f.driveFileId);
  const alreadyIntroduced = files.filter(
    (f) => !(f.origin === "candidate" && !f.driveFileId) && f.introducedAt,
  );
  const targets = files.filter(
    (f) => !(f.origin === "candidate" && !f.driveFileId) && !f.introducedAt,
  );

  if (targets.length > 0) {
    await prisma.candidateFile.updateMany({
      where: { id: { in: targets.map((f) => f.id) } },
      data: { introducedAt: new Date() },
    });
    try {
      await recalculateSubStatusIfAuto(candidateId);
    } catch (e) {
      console.error("[mark-introduced] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json({
    marked: targets.length,
    skippedSite: siteRows.length,
    skippedAlready: alreadyIntroduced.length,
    rejected: fileIds.length - files.length,
  });
}

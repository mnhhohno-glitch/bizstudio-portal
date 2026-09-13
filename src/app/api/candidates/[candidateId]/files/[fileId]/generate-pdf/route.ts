import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { AUTO_FILE_PDF_SELECT, generatePdfForAutoFile } from "@/lib/recommend/auto-approval-pdf";

// T-189 Phase3-2a: ブックマーク一覧（HistoryTab）で求人名をクリックしたときの PDF 遅延生成。
//   - 対象: 当該求職者の自動配信行（autoSourcedAt 非null）で driveFileId が無い行。
//     本人サイト由来（origin="candidate"）の PDF 無しは「サイト経由」の意味付けに使っているので対象外（404）。
//   - 承認状態は問わない（承認待ちの求人票を CA が先に開けるようにする）。
//   - 既に driveFileId があれば生成せず現状を返す（冪等）。生成は承認ページの「PDF再生成」と同じ経路
//     （generatePdfForAutoFile: pdf-service → Drive 保管 → OneDrive コピー起動）。
//   - 認証: セッション必須（他の files API と同じ）。行は candidateId でスコープする。
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, fileId } = await params;
  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId, autoSourcedAt: { not: null } },
    select: AUTO_FILE_PDF_SELECT,
  });
  if (!file) return NextResponse.json({ error: "自動配信の求人が見つかりません" }, { status: 404 });

  const r = await generatePdfForAutoFile(file);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error ?? "PDF生成に失敗しました" }, { status: 502 });
  }
  const after = await prisma.candidateFile.findUnique({
    where: { id: fileId },
    select: { driveFileId: true, driveViewUrl: true, mimeType: true, fileSize: true },
  });
  return NextResponse.json({ ok: true, fileId, ...after });
}

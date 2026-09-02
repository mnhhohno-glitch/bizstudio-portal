import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { AUTO_FILE_PDF_SELECT, generatePdfForAutoFile } from "@/lib/recommend/auto-approval-pdf";

// T-189 Phase3-1: 承認時に PDF 生成が失敗した行の再試行（自動由来行のみ）。
// T-189 Phase3-2a: 承認ページの「クリック時遅延生成」にも使うため、APPROVED 限定を外し
//   自動由来行なら承認状態を問わず生成する（driveFileId 済みなら冪等に ok・レスポンスに driveViewUrl を返す）。
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { fileId?: unknown };
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!fileId) return NextResponse.json({ error: "fileId は必須です" }, { status: 400 });

  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, autoSourcedAt: { not: null } },
    select: AUTO_FILE_PDF_SELECT,
  });
  if (!file) return NextResponse.json({ error: "自動配信行が見つかりません" }, { status: 404 });

  const r = await generatePdfForAutoFile(file);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "PDF生成に失敗しました" }, { status: 502 });
  const after = await prisma.candidateFile.findUnique({
    where: { id: fileId },
    select: { driveFileId: true, driveViewUrl: true },
  });
  return NextResponse.json({
    ok: true,
    fileId,
    driveFileId: after?.driveFileId ?? null,
    driveViewUrl: after?.driveViewUrl ?? null,
  });
}

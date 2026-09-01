import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { AUTO_FILE_PDF_SELECT, generatePdfForAutoFile } from "@/lib/recommend/auto-approval-pdf";

// T-189 Phase3-1: 承認時に PDF 生成が失敗した行の再試行（APPROVED かつ driveFileId 無しの自動由来行のみ）。
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { fileId?: unknown };
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!fileId) return NextResponse.json({ error: "fileId は必須です" }, { status: 400 });

  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, autoSourcedAt: { not: null }, approvalStatus: "APPROVED" },
    select: AUTO_FILE_PDF_SELECT,
  });
  if (!file) return NextResponse.json({ error: "承認済みの自動配信行が見つかりません" }, { status: 404 });

  const r = await generatePdfForAutoFile(file);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "PDF生成に失敗しました" }, { status: 502 });
  return NextResponse.json({ ok: true, fileId });
}

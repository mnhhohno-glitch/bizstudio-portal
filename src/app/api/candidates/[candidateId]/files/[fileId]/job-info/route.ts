import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { extractJobInfoFromText } from "@/lib/bookmark-job-info";

/**
 * GET /api/candidates/[candidateId]/files/[fileId]/job-info
 * T-184: 求人評価モーダルの「求人情報（CA向け）」セクション用。
 *
 * CandidateFile.extractedText（保存済みの求人本文）から 仕事内容 / 従業員数 / 会社概要 を
 * 素直に切り出して返すだけ。AI解析はしない。ai_analysis_comment には一切書き込まない。
 *
 * ⚠️ CA専用。認証は portal のセッション Cookie のみ（求職者サイトの Bearer/CORS は通さない）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId, fileId } = await params;
  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId },
    select: { id: true, extractedText: true, externalJobRef: true },
  });
  if (!file) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  const info = extractJobInfoFromText(file.extractedText);
  return NextResponse.json({
    ...info,
    // 求人データ（job-platform）と紐付いているか。UI の注記出し分け用。
    linked: Boolean(file.externalJobRef),
  });
}

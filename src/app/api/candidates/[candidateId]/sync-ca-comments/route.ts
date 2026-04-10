import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

function toMatchLabel(rating: string | null): string {
  switch (rating) {
    case "A": return "◎ 非常にマッチ";
    case "B": return "○ マッチ";
    case "C":
    case "D": return "△ チャレンジ求人";
    default: return "";
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const KYUUJIN_PDF_TOOL_URL = process.env.KYUUJIN_PDF_TOOL_URL;
  const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;
  if (!KYUUJIN_PDF_TOOL_URL || !KYUUJIN_API_SECRET) {
    return NextResponse.json({ error: "kyuujinPDF環境変数が未設定です" }, { status: 500 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });
  if (!candidate?.candidateNumber) {
    return NextResponse.json({ error: "求職者番号が未設定です" }, { status: 400 });
  }

  // ブックマークでaiAnalysisCommentがあるファイル一覧
  const files = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: "BOOKMARK",
      aiAnalysisComment: { not: null },
      aiMatchRating: { not: null },
    },
    select: {
      fileName: true,
      driveFileId: true,
      aiMatchRating: true,
      aiAnalysisComment: true,
    },
  });

  console.log(`[SyncCaComments] Found ${files.length} files with comments for ${candidate.candidateNumber}`);

  const comments = files
    .map((f) => {
      if (!f.aiAnalysisComment || !f.aiMatchRating) return null;
      const jobNumMatch = f.fileName.match(/_No(\d+)/i);
      // fileNameがあれば照合可能なのでスキップしない
      if (!jobNumMatch && !f.driveFileId && !f.fileName) return null;
      const commentBody = f.aiAnalysisComment
        .replace(/■\s*本人希望[：:]\s*[ABCD]\s*/g, "")
        .replace(/■\s*通過率[：:]\s*[ABCD]\s*/g, "")
        .replace(/■\s*総合[：:]\s*[ABCD]\s*/g, "")
        // 懸念点・確認事項セクションを丸ごと除去
        .replace(/◆\s*懸念[^◆]*/g, "")
        .replace(/◆\s*確認事項[^◆]*/g, "")
        .trim();
      const entry: { job_number?: string; drive_file_id?: string; file_name?: string; match_label: string; comment: string } = {
        match_label: toMatchLabel(f.aiMatchRating),
        comment: commentBody,
        file_name: f.fileName,
      };
      if (jobNumMatch) entry.job_number = jobNumMatch[1];
      if (f.driveFileId) entry.drive_file_id = f.driveFileId;
      return entry;
    })
    .filter((c): c is { job_number?: string; drive_file_id?: string; file_name?: string; match_label: string; comment: string } => c !== null);

  if (comments.length === 0) {
    console.log("[SyncCaComments] No comments to sync");
    return NextResponse.json({ synced: 0, message: "送信対象なし" });
  }

  try {
    const res = await fetch(`${KYUUJIN_PDF_TOOL_URL}/api/external/mypage/jobs/ca-comment`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": KYUUJIN_API_SECRET,
      },
      body: JSON.stringify({
        job_seeker_id: candidate.candidateNumber,
        comments,
      }),
    });
    const result = await res.json().catch(() => null);
    console.log("[SyncCaComments] Result:", { count: comments.length, status: res.status, result });
    return NextResponse.json({ synced: comments.length, status: res.status, result });
  } catch (e) {
    console.error("[SyncCaComments] Failed:", e);
    return NextResponse.json({ error: "kyuujinPDFへの送信に失敗しました" }, { status: 502 });
  }
}

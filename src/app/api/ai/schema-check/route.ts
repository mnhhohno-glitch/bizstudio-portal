import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertAiReadAuth } from "@/lib/aiRead/auth";

export const runtime = "nodejs";

// T-191: 件数・サンプルレコードを返すため /api/ai/company-kpi と同じ Bearer（AI_READ_API_KEY）を必須にする。
// 死活監視用の /api/ai/health は none のまま。
export async function GET(req: Request) {
  const deny = assertAiReadAuth(req);
  if (deny) return deny;

  const checks: Record<string, unknown> = {};

  try {
    checks.interviewRecordCount = await prisma.interviewRecord.count();
    checks.interviewDetailCount = await prisma.interviewDetail.count();
    checks.interviewRatingCount = await prisma.interviewRating.count();
    checks.interviewMemoCount = await prisma.interviewMemo.count();
    checks.interviewAttachmentCount = await prisma.interviewAttachment.count();
    checks.candidateMemoCount = await prisma.candidateMemo.count();

    const sampleRecord = await prisma.interviewRecord.findFirst({
      select: {
        id: true,
        status: true,
        isLatest: true,
        aiAnalysisResult: true,
        aiAnalysisAt: true,
        lastSavedAt: true,
        lastEditedBy: true,
        autosaveToken: true,
      },
    });
    checks.newInterviewRecordFieldsAccessible = true;
    checks.sampleRecord = sampleRecord;

    const sampleCandidate = await prisma.candidate.findFirst({
      include: {
        interviewRecords: {
          take: 1,
          include: {
            detail: true,
            rating: true,
            memos: true,
            attachments: true,
          },
        },
        candidateMemos: { take: 1 },
      },
    });
    checks.sampleRelationshipCheck = sampleCandidate
      ? "ok"
      : "no candidate found";

    return NextResponse.json({
      ok: true,
      phase: "Phase 3: Interview memos/attachments + CandidateMemo tables added",
      timestamp: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        phase: "Phase 3: Schema check failed",
        error: (error as Error).message,
        checks,
      },
      { status: 500 }
    );
  }
}

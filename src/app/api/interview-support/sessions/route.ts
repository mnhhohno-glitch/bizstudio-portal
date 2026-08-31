// T-183 Phase 2: 面談サポートセッションの一覧API（求職者単位）。
// 面談履歴の「面談サポート」タブ用。transcript / explanations 本文は返さず（行クリック時に
// GET /api/interview-support/sessions/[sessionId] で取得）、長さ表示に必要な最終時刻だけを導出して返す軽量一覧。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/** transcript ([{ t: ISO文字列, text }, ...]) の最終時刻。endedAt null（記録中/中断）の長さ概算に使う。 */
function lastTranscriptAt(transcript: unknown): string | null {
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  const last = transcript[transcript.length - 1] as { t?: unknown };
  return typeof last?.t === "string" ? last.t : null;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }

  const rows = await prisma.interviewSupportSession.findMany({
    where: { interviewRecord: { candidateId } },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      transcript: true,
      interviewRecord: { select: { id: true, interviewCount: true, interviewDate: true } },
      createdBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    sessions: rows.map((row) => ({
      id: row.id,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      lastTranscriptAt: lastTranscriptAt(row.transcript),
      interviewId: row.interviewRecord.id,
      interviewCount: row.interviewRecord.interviewCount,
      interviewDate: row.interviewRecord.interviewDate,
      createdByName: row.createdBy.name,
    })),
  });
}

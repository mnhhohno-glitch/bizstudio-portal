import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /api/scout/candidates/mynavi-history?candidateId=xxx
 * T-190 Step3-1: 求職者詳細で「マイナビのスカウト履歴一覧」を確認するための読み取り専用API。
 * 配信日がどの行から決まったのかを CA が画面で追えるようにするためのもの。
 *
 * selectedScoutDate は Candidate.scoutDeliveryDate の JST 暦日。
 * 受け口（/api/rpa/mynavi/scout-history）はこの日付＝採用行のスカウト日を書き込むので、
 * 応募済かつ scoutDate がこれと一致する行が「採用された行」になる。
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const candidateId = req.nextUrl.searchParams.get("candidateId")?.trim();
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId は必須です" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, scoutDeliveryDate: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const histories = await prisma.mynaviScoutHistory.findMany({
    where: { candidateId },
    orderBy: { scoutDate: "desc" },
    select: {
      id: true,
      scoutDate: true,
      subject: true,
      statusText: true,
      isApplied: true,
      recruiterName: true,
      fetchedAt: true,
    },
  });

  // 罠#17: toISOString().slice(0,10) は使わない
  const jstYmd = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  return NextResponse.json({
    selectedScoutDate: candidate.scoutDeliveryDate ? jstYmd(candidate.scoutDeliveryDate) : null,
    histories: histories.map((h) => ({
      id: h.id,
      scoutDate: jstYmd(h.scoutDate),
      subject: h.subject,
      statusText: h.statusText,
      isApplied: h.isApplied,
      recruiterName: h.recruiterName,
      fetchedAt: h.fetchedAt.toISOString(),
    })),
  });
}

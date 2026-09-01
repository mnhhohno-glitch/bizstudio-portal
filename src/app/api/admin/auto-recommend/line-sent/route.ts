import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";

// T-189 Phase3-1: 「LINE送信済み」ボタン。Candidate.lastLineSentAt = now（押し直しで上書き・確認なし）。
// LINE 本文の送信自体は行わない（CAが手動で送った記録だけを残す）。
export async function POST(req: Request) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { candidateId?: string };
  if (!body.candidateId) return NextResponse.json({ error: "candidateId は必須です" }, { status: 400 });

  const now = new Date();
  try {
    const c = await prisma.candidate.update({
      where: { id: body.candidateId },
      data: { lastLineSentAt: now },
      select: { id: true, lastLineSentAt: true },
    });
    return NextResponse.json({ ok: true, candidateId: c.id, lastLineSentAt: c.lastLineSentAt?.toISOString() ?? null });
  } catch (e) {
    console.error("[admin/auto-recommend/line-sent] failed:", e);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

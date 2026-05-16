import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /api/candidates/[candidateId]/settings-history
 * 求職者の設定履歴（一次返信送信履歴）一覧。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { candidateId } = await params;

  const histories = await prisma.candidateSettingsHistory.findMany({
    where: { candidateId },
    orderBy: { sentAt: "desc" },
  });

  return NextResponse.json({ histories });
}

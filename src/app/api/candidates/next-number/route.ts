import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // 5から始まる番号の最大値を取得
  const candidates = await prisma.candidate.findMany({
    where: { candidateNumber: { startsWith: "5" } },
    select: { candidateNumber: true },
    orderBy: { candidateNumber: "desc" },
    take: 1,
  });

  let nextNumber: number;
  if (candidates.length > 0) {
    const maxNum = parseInt(candidates[0].candidateNumber, 10);
    nextNumber = maxNum + 100;
  } else {
    nextNumber = 5000100;
  }

  // 空き番号を確認（衝突回避）
  let attempts = 0;
  while (attempts < 1000) {
    const exists = await prisma.candidate.findUnique({
      where: { candidateNumber: String(nextNumber) },
      select: { id: true },
    });
    if (!exists) break;
    nextNumber++;
    attempts++;
  }

  return NextResponse.json({ nextNumber: String(nextNumber) });
}

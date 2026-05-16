import { prisma } from "@/lib/prisma";

/**
 * 次の求職者番号を採番する（T-050 採番ロジック準拠）
 * - 5000000〜5899999 の範囲で最大値 +1
 * - 5900000 以上はテスト番号として除外
 * - 衝突回避ループで空き番号を確保
 *
 * NOTE: 採番ロジックは src/app/api/candidates/next-number/route.ts と同一。
 * RPA 自動登録など API 経由でない呼び出しのために関数化したもの。
 */
export async function generateNextCandidateNumber(): Promise<string> {
  const candidates = await prisma.candidate.findMany({
    where: {
      candidateNumber: { startsWith: "5", lt: "5900000" },
    },
    select: { candidateNumber: true },
    orderBy: { candidateNumber: "desc" },
    take: 1,
  });

  let nextNumber: number;
  if (candidates.length > 0) {
    const maxNum = parseInt(candidates[0].candidateNumber, 10);
    nextNumber = maxNum + 1;
  } else {
    nextNumber = 5000001;
  }

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

  return String(nextNumber);
}

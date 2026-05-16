import { prisma } from "@/lib/prisma";
import type { MynaviRpaProcessingLog } from "@prisma/client";

/**
 * 直近 windowMinutes 分以内の同一電話番号の処理ログを検索し、二重処理を判定する。
 * @param phoneNormalized 正規化済み電話番号（数字のみ）
 * @param windowMinutes 照合ウィンドウ（分）。デフォルト30分。
 * @returns 見つかれば該当の MynaviRpaProcessingLog、なければ null
 */
export async function checkDuplicateProcessing(
  phoneNormalized: string,
  windowMinutes = 30,
): Promise<MynaviRpaProcessingLog | null> {
  if (!phoneNormalized) return null;

  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  return prisma.mynaviRpaProcessingLog.findFirst({
    where: {
      phoneNormalized,
      processedAt: { gte: since },
    },
    orderBy: { processedAt: "desc" },
  });
}

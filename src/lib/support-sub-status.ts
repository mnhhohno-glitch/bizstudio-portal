import { prisma } from "@/lib/prisma";
import { SUPPORT_SUB_STATUS_DEFAULT } from "@/lib/support-status-constants";

export {
  SUPPORT_STATUS_VALUES,
  SUPPORT_STATUS_LABEL,
  SUPPORT_SUB_STATUS_MAP,
  SUPPORT_SUB_STATUS_DEFAULT,
  isSubStatusFixed,
} from "@/lib/support-status-constants";
export type { SupportStatus } from "@/lib/support-status-constants";

/**
 * 支援中の求職者に対して、JobEntry / CandidateFile の状態から
 * 中項目を自動判定する。
 */
export async function calculateSubStatus(candidateId: string): Promise<string> {
  const entries = await prisma.jobEntry.findMany({
    where: { candidateId },
    select: {
      entryFlag: true,
      personFlag: true,
      hasJoined: true,
    },
  });

  // 1. 入社済
  if (entries.some((e) => e.personFlag === "入社済" || e.hasJoined === true)) {
    return "入社済";
  }
  // 2. 内定
  if (entries.some((e) => e.entryFlag === "内定")) return "内定";
  // 3. 面接
  if (entries.some((e) => e.entryFlag === "面接")) return "面接";
  // 4. 書類選考
  if (entries.some((e) => e.entryFlag === "書類選考")) return "書類選考";
  // 5. エントリー
  if (entries.some((e) => e.entryFlag === "エントリー")) return "エントリー";
  // 6. 求人紹介（JobEntryにentryFlag="求人紹介"のレコードがある）
  if (entries.some((e) => e.entryFlag === "求人紹介")) return "求人紹介";
  // 7. BM（BOOKMARKファイルがある）
  const bookmarkCount = await prisma.candidateFile.count({
    where: { candidateId, category: "BOOKMARK" },
  });
  if (bookmarkCount > 0) return "BM";
  // 8. 該当なし
  return "求人紹介前";
}

/**
 * 大項目の変更に伴い、中項目をリセットする。
 * - ACTIVE の場合は自動判定を実行
 * - それ以外は固定値を返す
 */
export async function resetSubStatusForStatus(
  candidateId: string,
  supportStatus: string
): Promise<string> {
  if (supportStatus === "ACTIVE") {
    return calculateSubStatus(candidateId);
  }
  return SUPPORT_SUB_STATUS_DEFAULT[supportStatus] ?? "";
}

/**
 * 自動判定トリガー: エントリーフラグ変更 / BOOKMARK追加・削除 などから呼ぶ。
 * - supportStatus が ACTIVE でない場合は何もしない
 * - supportSubStatusManual が true の場合は手動優先で何もしない
 */
export async function recalculateSubStatusIfAuto(candidateId: string): Promise<void> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { supportStatus: true, supportSubStatusManual: true },
  });
  if (!candidate) return;
  if (candidate.supportStatus !== "ACTIVE") return;
  if (candidate.supportSubStatusManual) return;

  const next = await calculateSubStatus(candidateId);
  await prisma.candidate.update({
    where: { id: candidateId },
    data: { supportSubStatus: next },
  });
}

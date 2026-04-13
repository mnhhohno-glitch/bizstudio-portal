import { prisma } from "@/lib/prisma";

export const SUPPORT_STATUS_VALUES = ["BEFORE", "ACTIVE", "WAITING", "ENDED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUS_VALUES)[number];

export const SUPPORT_STATUS_LABEL: Record<string, string> = {
  BEFORE: "支援前",
  ACTIVE: "支援中",
  WAITING: "待機",
  ENDED: "支援終了",
};

export const SUPPORT_SUB_STATUS_MAP: Record<string, string[]> = {
  BEFORE: ["面談前"],
  ACTIVE: ["求人紹介前", "BM", "求人紹介", "エントリー", "書類選考", "面接", "内定", "入社済"],
  WAITING: ["待機"],
  ENDED: ["当社判断", "本人希望"],
};

export const SUPPORT_SUB_STATUS_DEFAULT: Record<string, string> = {
  BEFORE: "面談前",
  ACTIVE: "求人紹介前",
  WAITING: "待機",
  ENDED: "当社判断",
};

// 大項目が変更不可（= 中項目が1択）のケース
export function isSubStatusFixed(supportStatus: string): boolean {
  return supportStatus === "BEFORE" || supportStatus === "WAITING";
}

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

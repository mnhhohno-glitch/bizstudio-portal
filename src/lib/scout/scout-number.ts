/**
 * T-064 Phase A: スカウト番号採番・解析
 *
 * フォーマット: SC + 8桁数字（例: SC10062653）
 * トランザクション内で実行し、並列リクエストでの重複を防ぐ。
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use"
>;

/**
 * 単発の採番。内部で $transaction を張る。
 * 大量採番時は generateScoutNumbers を使うこと。
 */
export async function generateScoutNumber(): Promise<string> {
  return prisma.$transaction(async (tx) => {
    return await generateScoutNumberInTx(tx);
  });
}

/**
 * 既存トランザクション内での採番。
 * 外側で $transaction を張りたい呼び出し（一括作成等）に使う。
 */
export async function generateScoutNumberInTx(tx: TxClient): Promise<string> {
  const sequence = await tx.scoutSequence.findFirst();
  if (!sequence) {
    throw new Error("ScoutSequence not initialized — run prisma/seed-scout-masters.ts");
  }
  const nextNumber = sequence.lastNumber + 1;
  await tx.scoutSequence.update({
    where: { id: sequence.id },
    data: { lastNumber: nextNumber },
  });
  return formatScoutNumber(nextNumber);
}

/**
 * N 件を一括採番（連番）。配信枠の翌日分作成等で使う。
 */
export async function reserveScoutNumbers(count: number): Promise<string[]> {
  if (count <= 0) return [];
  return prisma.$transaction(async (tx) => {
    const sequence = await tx.scoutSequence.findFirst();
    if (!sequence) {
      throw new Error("ScoutSequence not initialized");
    }
    const start = sequence.lastNumber + 1;
    const end = sequence.lastNumber + count;
    await tx.scoutSequence.update({
      where: { id: sequence.id },
      data: { lastNumber: end },
    });
    const result: string[] = [];
    for (let n = start; n <= end; n++) {
      result.push(formatScoutNumber(n));
    }
    return result;
  });
}

export function formatScoutNumber(n: number): string {
  return `SC${n.toString().padStart(8, "0")}`;
}

export function parseScoutNumber(scoutNumber: string): number | null {
  const m = scoutNumber.match(/^SC(\d{8})$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

export function isValidScoutNumberFormat(scoutNumber: string): boolean {
  return /^SC\d{8}$/.test(scoutNumber);
}

// T-080: 面談「結果」(InterviewRecord.resultFlag) → 求職者「フラグ」(Candidate.supportStatus) 自動マッピング。
// 候補者の最新面談（interviewCount 最大、同数なら interviewDate 最新）の resultFlag を基準に supportStatus を更新する。
// マッピング表に無い結果値 / null は何もしない（誤った上書きを防ぐ）。
// supportSubStatus は status 変更時の整合のために併せて更新する（手動上書き済みは触らない）。

import { prisma } from "@/lib/prisma";
import type { SupportStatus } from "@/lib/support-status-constants";
import { SUPPORT_SUB_STATUS_DEFAULT } from "@/lib/support-status-constants";
import { calculateSubStatus } from "@/lib/support-sub-status";

/**
 * 面談結果 → supportStatus マッピング表。
 * resultFlag の正式文字列は src/components/candidates/InterviewForm.tsx の options 配列が source of truth。
 * 区切り文字（半角スペース vs アンダースコア）も含めて一字一句一致させる。
 * マッピングに無い値 / null は呼び出し側で「何もしない」扱いとする。
 */
export const RESULT_FLAG_TO_SUPPORT_STATUS: Record<string, SupportStatus> = {
  "面談前": "BEFORE",
  "連絡なし辞退": "ENDED",
  "連絡あり辞退": "ENDED",
  "支援終了_当社判断": "ENDED",
  "支援終了_本人希望": "ENDED",
  "求人紹介 送付前": "ACTIVE",
  "求人紹介 送付済": "ACTIVE",
  "継続": "ACTIVE",
  "保留": "ACTIVE",
};

/**
 * 候補者の最新面談 resultFlag に応じて Candidate.supportStatus を更新する。
 * - 最新面談 = interviewCount 最大、同数なら interviewDate 最新。
 *   interviewCount=null は NULLS LAST 相当（並びの最後）にする。
 * - resultFlag が null / マッピング表に無い値 → 何もしない（早期 return）。
 * - 既に supportStatus が一致 → 何もしない（不要な書き込みを回避）。
 * - supportSubStatus は手動上書き(`supportSubStatusManual=true`)なら触らない。
 *   そうでなければ ACTIVE は calculateSubStatus で自動判定、それ以外は既定値にリセット。
 *
 * 例外は throw しない（保存処理を壊さないため、エラーはログのみ）。
 */
export async function applyLatestInterviewResultToSupportStatus(
  candidateId: string,
): Promise<void> {
  try {
    const latest = await prisma.interviewRecord.findFirst({
      where: { candidateId },
      orderBy: [
        { interviewCount: { sort: "desc", nulls: "last" } },
        { interviewDate: "desc" },
      ],
      select: { resultFlag: true },
    });
    if (!latest || !latest.resultFlag) return;
    const nextStatus = RESULT_FLAG_TO_SUPPORT_STATUS[latest.resultFlag];
    if (!nextStatus) return;

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { supportStatus: true, supportSubStatusManual: true },
    });
    if (!candidate) return;
    if (candidate.supportStatus === nextStatus) return;

    const data: { supportStatus: SupportStatus; supportSubStatus?: string } = {
      supportStatus: nextStatus,
    };
    if (!candidate.supportSubStatusManual) {
      if (nextStatus === "ACTIVE") {
        data.supportSubStatus = await calculateSubStatus(candidateId);
      } else {
        data.supportSubStatus = SUPPORT_SUB_STATUS_DEFAULT[nextStatus] ?? "";
      }
    }

    await prisma.candidate.update({
      where: { id: candidateId },
      data,
    });
  } catch (err) {
    console.error("[T-080] applyLatestInterviewResultToSupportStatus failed", {
      candidateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

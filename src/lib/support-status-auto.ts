import { prisma } from "@/lib/prisma";
import { SELECTION_ENDED_DETAILS, INACTIVE_TRIGGERS } from "@/lib/constants/entry-flag-rules";

/**
 * Check if a candidate should be auto-ended based on entry flags.
 * Call this after any entry flag change.
 */
export async function checkAutoSupportEnd(
  candidateId: string,
  triggerEntryFlag: string | null,
  triggerFlagDetail: string | null,
  triggerPersonFlag: string | null
): Promise<void> {
  // Don't auto-end if already ended
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { supportStatus: true },
  });
  if (!candidate || candidate.supportStatus === "ENDED") return;

  // Determine reason from trigger
  let reason: string | null = null;

  // HIRED: person flag is 入社案内通知済 or 入社済
  if (triggerPersonFlag === "入社済" || triggerPersonFlag === "入社案内通知済") {
    reason = "HIRED";
    // Hired is always auto-set regardless of other entries
    await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        supportStatus: "ENDED",
        supportEndReason: reason,
        supportEndDate: new Date(),
      },
    });
    return;
  }

  // For other reasons, only auto-end if NO active entries remain
  const activeCount = await countActiveEntries(candidateId);
  if (activeCount > 0) return;

  // Determine reason based on trigger
  if (triggerFlagDetail === "本人辞退_他社決") {
    reason = "OFFER_DECLINED_OTHER";
  } else if (triggerFlagDetail === "本人辞退_自社他") {
    reason = "OFFER_DECLINED_SELF";
  } else if (
    triggerFlagDetail === "本人辞退" ||
    triggerPersonFlag === "辞退受付済" ||
    SELECTION_ENDED_DETAILS.includes(triggerFlagDetail || "")
  ) {
    // Check if it's selection rejection or withdrawal
    if (triggerFlagDetail === "選考落ち") {
      reason = "REJECTED_ALL";
    } else {
      reason = "WITHDREW_DURING_SELECTION";
    }
  } else if (
    triggerPersonFlag && INACTIVE_TRIGGERS.personFlags.includes(triggerPersonFlag)
  ) {
    reason = "WITHDREW_DURING_SELECTION";
  } else if (triggerFlagDetail === "選考落ち") {
    reason = "REJECTED_ALL";
  }

  if (reason) {
    await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        supportStatus: "ENDED",
        supportEndReason: reason,
        supportEndDate: new Date(),
      },
    });
  }
}

async function countActiveEntries(candidateId: string): Promise<number> {
  return prisma.jobEntry.count({
    where: {
      candidateId,
      isActive: true,
    },
  });
}

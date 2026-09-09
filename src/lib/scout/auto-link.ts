/**
 * T-064: PDF取り込み時の応募者 → 配信枠 自動紐付けロジック
 *
 * findMatchingSlot:
 *   recruiterName + applicationDate (JST 日付) を起点に、
 *   ScoutMachineMaster → machineId を引き、当該日の ScoutDeliverySlot から1件選ぶ。
 *   候補が複数なら deliveryCount>0 を優先、その中で hourSlot が現在時刻 (JST) に近いものを選択。
 *   当日0件なら前日でも同じ手順で再検索。
 *
 * autoLinkCandidateToSlot:
 *   findMatchingSlot で得た枠を Candidate に書き戻す (scoutDeliverySlotId, scoutNumber,
 *   scoutLinkedAt, scoutLinkedById=null)。
 */

import { prisma } from "@/lib/prisma";

export type AutoLinkReason =
  | "matched"
  | "no_recruiter_name"
  | "no_machine_master"
  | "no_candidate_today"
  | "no_candidate_yesterday"
  | "error";

export type MatchedSlot = {
  slotId: string;
  scoutNumber: string;
  deliveryDate: Date;
  hourSlot: number;
};

/** YYYY-MM-DD (JST) -> Date (UTC 00:00) */
export function toJstDateOnly(date: Date): Date {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** スペース（半角・全角）を全て除去して小文字化 */
function normalizeRecruiterName(s: string): string {
  return s.replace(/[\s　]+/g, "").toLowerCase();
}

/**
 * ScoutMachineMaster で recruiterName をマッチさせる。
 *  - 半角/全角スペースを全削除して比較（"藤本 なつみ" == "藤本なつみ"）
 *  - aliases 配列も同様に正規化して比較（"RPA1号機" == "RPA 1号機"）
 *
 * マスタは 10件程度なので全件取得 → JS で比較する。
 */
async function findMachineByRecruiterName(recruiterName: string) {
  const trimmed = recruiterName.trim();
  if (!trimmed) return null;
  const target = normalizeRecruiterName(trimmed);

  const machines = await prisma.scoutMachineMaster.findMany();
  for (const m of machines) {
    if (normalizeRecruiterName(m.recruiterName) === target) return m;
    if (m.aliases.some((a) => normalizeRecruiterName(a) === target)) return m;
  }
  return null;
}

/** machineId × deliveryDate (UTC 00:00) のスロットから1件選ぶ */
export async function pickBestSlot(machineId: string, deliveryDate: Date): Promise<MatchedSlot | null> {
  const slots = await prisma.scoutDeliverySlot.findMany({
    where: { machineId, deliveryDate },
    select: {
      id: true,
      scoutNumber: true,
      deliveryDate: true,
      hourSlot: true,
      deliveryCount: true,
    },
  });
  if (slots.length === 0) return null;
  if (slots.length === 1) {
    const s = slots[0];
    return { slotId: s.id, scoutNumber: s.scoutNumber, deliveryDate: s.deliveryDate, hourSlot: s.hourSlot };
  }
  const hasDelivery = slots.filter((s) => s.deliveryCount > 0);
  const pool = hasDelivery.length > 0 ? hasDelivery : slots;
  // JST 現在時刻
  const now = new Date();
  const jstHour = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
  pool.sort((a, b) => {
    const da = Math.abs(a.hourSlot - jstHour);
    const db = Math.abs(b.hourSlot - jstHour);
    if (da !== db) return da - db;
    return b.deliveryCount - a.deliveryCount;
  });
  const best = pool[0];
  return {
    slotId: best.id,
    scoutNumber: best.scoutNumber,
    deliveryDate: best.deliveryDate,
    hourSlot: best.hourSlot,
  };
}

export async function findMatchingSlot(params: {
  recruiterName: string;
  applicationDate: Date;
  /** T-135: 配信日（Excel照合値）。あれば応募日より優先して枠を探す。 */
  scoutDeliveryDate?: Date | null;
}): Promise<MatchedSlot | null> {
  const machine = await findMachineByRecruiterName(params.recruiterName);
  if (!machine) return null;

  // T-135: 配信日ベース化。scoutDeliveryDate があればそれを起点に、無ければ従来どおり応募日。
  const usedDeliveryDate = params.scoutDeliveryDate != null;
  const anchorDate = params.scoutDeliveryDate ?? params.applicationDate;
  const anchorKind = usedDeliveryDate ? "scoutDeliveryDate" : "applicationDate";

  const dayJst = toJstDateOnly(anchorDate);
  const today = await pickBestSlot(machine.id, dayJst);
  if (today) {
    console.log(
      `[scout/auto-link] findMatchingSlot matched by ${anchorKind}=${dayJst.toISOString().slice(0, 10)} (machine=${machine.id})`,
    );
    return today;
  }

  const yesterdayJst = addDays(dayJst, -1);
  const yesterday = await pickBestSlot(machine.id, yesterdayJst);
  if (yesterday) {
    console.log(
      `[scout/auto-link] findMatchingSlot matched by ${anchorKind}-1d=${yesterdayJst.toISOString().slice(0, 10)} (machine=${machine.id})`,
    );
  }
  return yesterday;
}

export async function autoLinkCandidateToSlot(params: {
  candidateId: string;
  recruiterName: string | null;
  applicationDate: Date;
  /** T-135: 配信日（Excel照合値）。あれば応募日より優先して枠を探す。 */
  scoutDeliveryDate?: Date | null;
}): Promise<{
  linked: boolean;
  slotId?: string;
  scoutNumber?: string;
  reason: AutoLinkReason;
}> {
  if (!params.recruiterName?.trim()) {
    return { linked: false, reason: "no_recruiter_name" };
  }

  try {
    const machine = await findMachineByRecruiterName(params.recruiterName);
    if (!machine) {
      return { linked: false, reason: "no_machine_master" };
    }

    // T-135: 配信日ベース化。scoutDeliveryDate があればそれを起点に、無ければ従来どおり応募日。
    const usedDeliveryDate = params.scoutDeliveryDate != null;
    const anchorDate = params.scoutDeliveryDate ?? params.applicationDate;
    const anchorKind = usedDeliveryDate ? "scoutDeliveryDate" : "applicationDate";

    const dayJst = toJstDateOnly(anchorDate);
    let slot = await pickBestSlot(machine.id, dayJst);
    let usedYesterday = false;
    if (!slot) {
      const yesterdayJst = addDays(dayJst, -1);
      slot = await pickBestSlot(machine.id, yesterdayJst);
      usedYesterday = true;
    }

    if (!slot) {
      return {
        linked: false,
        reason: usedYesterday ? "no_candidate_yesterday" : "no_candidate_today",
      };
    }

    console.log(
      `[scout/auto-link] autoLink candidate=${params.candidateId} by ${anchorKind}=${dayJst.toISOString().slice(0, 10)}${usedYesterday ? " (-1d)" : ""} -> slot=${slot.slotId}`,
    );

    await prisma.candidate.update({
      where: { id: params.candidateId },
      data: {
        scoutDeliverySlotId: slot.slotId,
        scoutNumber: slot.scoutNumber,
        scoutLinkedAt: new Date(),
        scoutLinkedById: null,
      },
    });

    return {
      linked: true,
      slotId: slot.slotId,
      scoutNumber: slot.scoutNumber,
      reason: "matched",
    };
  } catch (e) {
    console.error("[scout/auto-link] failed:", e);
    return { linked: false, reason: "error" };
  }
}

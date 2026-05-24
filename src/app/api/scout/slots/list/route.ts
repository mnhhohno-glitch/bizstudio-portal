/**
 * T-064: 配信レコード一覧 API
 *
 * GET /api/scout/slots/list
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *   &deliveryCategoryLarge=...&deliveryCategoryMedium=...
 *   &machineId=...&mediaSource=...
 *   &sortBy=deliveryDate&sortOrder=desc
 *
 * 各行ごとに開封率・応募率・年代別応募数（20/30/40/50代）を計算して返す。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";

type SortKey =
  | "deliveryDate"
  | "hourSlot"
  | "deliveryCount"
  | "openCount"
  | "applyCount"
  | "scoutNumber";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function dayOfWeekJa(date: Date): string {
  return DOW[date.getUTCDay()];
}

function timeBlock(hour: number): string {
  if (hour < 12) return "午前";
  if (hour < 14) return "昼";
  if (hour < 17) return "午後";
  return "夕方";
}

/** birthday と applicationDate から「応募日基準の満年齢」を算出 */
function ageAtDate(birthday: Date, at: Date): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const m = at.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birthday.getDate())) age--;
  return age;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");
  if (!startDateStr || !endDateStr) {
    return NextResponse.json({ error: "startDate / endDate は必須です" }, { status: 400 });
  }

  let startDate: Date;
  let endDate: Date;
  try {
    startDate = parseSlotDate(startDateStr);
    endDate = parseSlotDate(endDateStr);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const deliveryCategoryLarge = searchParams.get("deliveryCategoryLarge");
  const deliveryCategoryMedium = searchParams.get("deliveryCategoryMedium");
  const machineId = searchParams.get("machineId");
  const mediaSource = searchParams.get("mediaSource");
  const sortBy = (searchParams.get("sortBy") || "deliveryDate") as SortKey;
  const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

  const where: Record<string, unknown> = {
    deliveryDate: { gte: startDate, lte: endDate },
  };
  if (deliveryCategoryLarge) where.deliveryCategoryLarge = deliveryCategoryLarge;
  if (deliveryCategoryMedium) where.deliveryCategoryMedium = deliveryCategoryMedium;
  if (machineId) where.machineId = machineId;
  if (mediaSource) where.mediaSource = mediaSource;

  try {
    const slots = await prisma.scoutDeliverySlot.findMany({
      where,
      include: {
        machine: true,
        linkedCandidates: {
          select: { id: true, birthday: true, createdAt: true },
        },
      },
    });

    const rows = slots.map((slot) => {
      const ageGroups = { "20s": 0, "30s": 0, "40s": 0, "50s": 0 };
      for (const c of slot.linkedCandidates) {
        if (!c.birthday) continue;
        const age = ageAtDate(c.birthday, c.createdAt);
        if (age >= 20 && age < 30) ageGroups["20s"]++;
        else if (age >= 30 && age < 40) ageGroups["30s"]++;
        else if (age >= 40 && age < 50) ageGroups["40s"]++;
        else if (age >= 50 && age < 60) ageGroups["50s"]++;
      }
      const applyCount = slot.linkedCandidates.length;
      const openRate = slot.deliveryCount > 0 ? (slot.openCount / slot.deliveryCount) * 100 : 0;
      const applyRate1 = slot.deliveryCount > 0 ? (applyCount / slot.deliveryCount) * 100 : 0;
      const applyRate2 = slot.openCount > 0 ? (applyCount / slot.openCount) * 100 : 0;
      return {
        id: slot.id,
        scoutNumber: slot.scoutNumber,
        deliveryCategoryLarge: slot.deliveryCategoryLarge,
        deliveryCategoryMedium: slot.deliveryCategoryMedium,
        deliveryCategorySmall: slot.deliveryCategorySmall,
        mediaSource: slot.mediaSource,
        machineId: slot.machineId,
        machine: slot.machine
          ? {
              id: slot.machine.id,
              recruiterName: slot.machine.recruiterName,
              machineLabel: slot.machine.machineLabel,
              isMachine: slot.machine.isMachine,
              isActive: slot.machine.isActive,
            }
          : null,
        deliveryDate: slot.deliveryDate.toISOString().slice(0, 10),
        dayOfWeek: dayOfWeekJa(slot.deliveryDate),
        hourSlot: slot.hourSlot,
        timeBlock: timeBlock(slot.hourSlot),
        deliveryCount: slot.deliveryCount,
        openCount: slot.openCount,
        openRate: Number(openRate.toFixed(2)),
        applyCount,
        applyRate1: Number(applyRate1.toFixed(2)),
        applyRate2: Number(applyRate2.toFixed(2)),
        searchConditionName: slot.searchConditionName,
        isAggregationTarget: slot.isAggregationTarget,
        isMachine: slot.isMachine,
        ageGroups,
      };
    });

    // ソート
    const dir = sortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const get = (r: typeof rows[number]) => {
        switch (sortBy) {
          case "deliveryDate":
            return `${r.deliveryDate}-${String(r.hourSlot).padStart(2, "0")}`;
          case "hourSlot":
            return r.hourSlot;
          case "deliveryCount":
            return r.deliveryCount;
          case "openCount":
            return r.openCount;
          case "applyCount":
            return r.applyCount;
          case "scoutNumber":
            return r.scoutNumber;
          default:
            return r.deliveryDate;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return NextResponse.json({ slots: rows, total: rows.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

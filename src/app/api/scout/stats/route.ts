/**
 * GET /api/scout/stats?axis={overall|media|machine|category}&from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy={day|week|month}&dateMode={sent|applied}
 *   集計データを返す
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";

type Bucket = {
  key: string;
  deliveryCount: number;
  openCount: number;
  applyCount: number;
};

function bucketKey(date: Date, groupBy: "day" | "week" | "month"): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  if (groupBy === "month") return `${y}-${m}`;
  if (groupBy === "week") {
    // 月曜起点
    const day = date.getUTCDay() || 7;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - day + 1);
    return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  }
  return `${y}-${m}-${d}`;
}

/**
 * T-135: 生タイムスタンプ（createdAt 等）を JST 暦日ベースでバケットキー化する（罠#17）。
 * +9h シフトしてから UTC getter ベースの bucketKey に委譲することで、
 * day/week/month いずれも JST の暦日/週/月として切れる。
 */
function jstBucketKey(date: Date, groupBy: "day" | "week" | "month"): string {
  return bucketKey(new Date(date.getTime() + 9 * 60 * 60 * 1000), groupBy);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const axis = (searchParams.get("axis") || "overall") as
    | "overall"
    | "media"
    | "machine"
    | "category";
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const groupBy = (searchParams.get("groupBy") || "day") as "day" | "week" | "month";
  const dateMode = (searchParams.get("dateMode") || "sent") as "sent" | "applied";

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from/to は必須です" }, { status: 400 });
  }

  const fromDate = parseSlotDate(fromStr);
  const toDate = parseSlotDate(toStr);

  // 配信枠を集計（集計対象のみ）
  const slots = await prisma.scoutDeliverySlot.findMany({
    where: {
      deliveryDate: { gte: fromDate, lte: toDate },
      isAggregationTarget: true,
    },
    include: {
      machine: true,
      linkedCandidates: { select: { id: true, createdAt: true, applicationDate: true } },
    },
  });

  // バケット集計
  const bucketMap = new Map<string, Bucket>();
  const subBucketMap = new Map<string, Map<string, Bucket>>();

  for (const slot of slots) {
    // 軸（媒体/号機/配信種別）は枠単位で決まる
    let subKey = "ALL";
    if (axis === "media") subKey = slot.mediaSource;
    else if (axis === "machine") subKey = slot.machine?.machineLabel ?? "未割当";
    else if (axis === "category") subKey = slot.deliveryCategoryLarge;

    const map =
      axis === "overall"
        ? bucketMap
        : (() => {
            if (!subBucketMap.has(subKey)) subBucketMap.set(subKey, new Map());
            return subBucketMap.get(subKey)!;
          })();

    const ensure = (key: string): Bucket => {
      if (!map.has(key)) {
        map.set(key, { key, deliveryCount: 0, openCount: 0, applyCount: 0 });
      }
      return map.get(key)!;
    };

    // 配信数・開封数は常に「配信日（deliveryDate）」バケットへ（@db.Date, UTC getter で正しい）
    const deliveryBucket = ensure(bucketKey(slot.deliveryDate, groupBy));
    deliveryBucket.deliveryCount += slot.deliveryCount;
    deliveryBucket.openCount += slot.openCount;

    if (dateMode === "sent") {
      // 従来どおり：応募数も配信日バケット（後方互換）
      deliveryBucket.applyCount += slot.linkedCandidates.length;
    } else {
      // T-135: dateMode=applied は候補者1人ずつ「応募日」バケットへ計上する。
      // applicationDate（date-only, 正午/深夜UTC保存）は現行の UTC getter（bucketKey）で正しい。
      // applicationDate が無い場合のみ createdAt（生タイムスタンプ）を JST 変換（罠#17）。
      for (const c of slot.linkedCandidates) {
        const applyKey = c.applicationDate
          ? bucketKey(c.applicationDate, groupBy)
          : jstBucketKey(c.createdAt, groupBy);
        ensure(applyKey).applyCount += 1;
      }
    }
  }

  const overall = Array.from(bucketMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  const subBuckets: Record<string, Bucket[]> = {};
  for (const [subKey, map] of subBucketMap.entries()) {
    subBuckets[subKey] = Array.from(map.values()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
  }

  return NextResponse.json({
    axis,
    groupBy,
    dateMode,
    overall,
    subBuckets,
  });
}

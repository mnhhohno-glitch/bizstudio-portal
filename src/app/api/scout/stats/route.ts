/**
 * GET /api/scout/stats?axis={overall|media|machine|category}&from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy={day|week|month|hour}&dateMode={sent|applied}
 *   集計データを返す
 *
 * groupBy=hour（T-135 T-B・後方互換の純追加）: 配信枠の hourSlot(8〜19) でバケット。
 *   キーは "8"〜"19"。配信数/開封数は枠、応募数は紐付き枠の hourSlot に帰属（応募時刻ではなく
 *   配信された時間帯＝配信日起算の思想と一貫）。day/week/month・dateMode の挙動は不変。
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
  const groupBy = (searchParams.get("groupBy") || "day") as "day" | "week" | "month" | "hour";
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

    // 配信数・開封数は常に「配信日（deliveryDate）」バケットへ（@db.Date, UTC getter で正しい）。
    // groupBy=hour のときは日付でなく枠の hourSlot（"8"〜"19"）でバケットする。
    const deliveryBucket = ensure(
      groupBy === "hour" ? String(slot.hourSlot) : bucketKey(slot.deliveryDate, groupBy),
    );
    deliveryBucket.deliveryCount += slot.deliveryCount;
    deliveryBucket.openCount += slot.openCount;

    if (dateMode === "sent") {
      // 従来どおり：応募数も配信日バケット（後方互換）
      deliveryBucket.applyCount += slot.linkedCandidates.length;
    }
    // dateMode === "applied" のときは下で候補者テーブルから直接集計する（配信枠の期間フィルタから独立）
  }

  if (dateMode === "applied") {
    // T-135 step9: applied 期間フィルタは「応募日（applicationDate ?? createdAt+9h の JST 暦日）」ベースに変更。
    // 従来は配信枠の deliveryDate 範囲でスロットを絞り込んでから linkedCandidates を集計していたため、
    // 5月配信 → 6月応募のような月またぎ応募が期間から漏れていた（例: 2026-06-01 の応募11件のうち4件が漏れて7件と表示）。
    // 集計対象は現行どおり「枠に紐付いた候補者かつ枠が isAggregationTarget=true」。
    const fromMs = fromDate.getTime();
    const toMs = toDate.getTime();
    // applicationDate=null のフォールバック: JST 日付が [from,to] 内 ⇔ createdAt（UTC）が [from-9h, to+1日-9h)
    const fallbackFrom = new Date(fromMs - 9 * 60 * 60 * 1000);
    const fallbackToExclusive = new Date(toMs + 24 * 60 * 60 * 1000 - 9 * 60 * 60 * 1000);
    const applied = await prisma.candidate.findMany({
      where: {
        scoutDeliverySlotId: { not: null },
        scoutDeliverySlot: { is: { isAggregationTarget: true } },
        OR: [
          { applicationDate: { gte: fromDate, lte: toDate } },
          {
            applicationDate: null,
            createdAt: { gte: fallbackFrom, lt: fallbackToExclusive },
          },
        ],
      },
      select: {
        applicationDate: true,
        createdAt: true,
        scoutDeliverySlot: {
          select: {
            mediaSource: true,
            hourSlot: true,
            deliveryCategoryLarge: true,
            machine: { select: { machineLabel: true } },
          },
        },
      },
    });

    for (const c of applied) {
      const slot = c.scoutDeliverySlot!;
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
        if (!map.has(key)) map.set(key, { key, deliveryCount: 0, openCount: 0, applyCount: 0 });
        return map.get(key)!;
      };
      const applyKey =
        groupBy === "hour"
          ? String(slot.hourSlot)
          : c.applicationDate
            ? bucketKey(c.applicationDate, groupBy)
            : jstBucketKey(c.createdAt, groupBy);
      ensure(applyKey).applyCount += 1;
    }
  }

  // hour は数値順、それ以外は文字列順（"YYYY-MM-DD" 等は辞書順＝時系列順）
  const sortBuckets = (arr: Bucket[]): Bucket[] =>
    groupBy === "hour"
      ? arr.sort((a, b) => Number(a.key) - Number(b.key))
      : arr.sort((a, b) => a.key.localeCompare(b.key));

  const overall = sortBuckets(Array.from(bucketMap.values()));
  const subBuckets: Record<string, Bucket[]> = {};
  for (const [subKey, map] of subBucketMap.entries()) {
    subBuckets[subKey] = sortBuckets(Array.from(map.values()));
  }

  return NextResponse.json({
    axis,
    groupBy,
    dateMode,
    overall,
    subBuckets,
  });
}

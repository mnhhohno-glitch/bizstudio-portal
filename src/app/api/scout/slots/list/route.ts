/**
 * T-064: 配信レコード一覧 API
 *
 * GET /api/scout/slots/list
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *   &deliveryCategoryLarge=...&deliveryCategoryMedium=...
 *   &machineId=...&mediaSource=...
 *
 *   # ソート（v2: 複合ソート対応）
 *   &sortBy=deliveryCategoryLarge:asc,deliveryDate:desc
 *   または
 *   &sortBy[]=deliveryCategoryLarge:asc&sortBy[]=deliveryDate:desc
 *
 *   # 旧形式（後方互換）
 *   &sortBy=deliveryDate&sortOrder=desc
 *
 * 各行ごとに開封率・応募率・年代別応募数（〜20代/30代/40代/50代〜/外国籍）・
 * 有効/無効応募数・有効/無効応募率を計算して返す。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";
import { isForeignNg } from "@/lib/mynavi-rpa/judgment";

type SortKey =
  | "deliveryCategoryLarge"
  | "machineId"
  | "deliveryDate"
  | "hourSlot"
  | "deliveryCount"
  | "openCount"
  | "openRate"
  | "applyCount"
  | "applyRate1"
  | "applyRate2"
  | "scoutNumber";

type SortSpec = { column: SortKey; order: "asc" | "desc" };

const VALID_SORT_KEYS: SortKey[] = [
  "deliveryCategoryLarge",
  "machineId",
  "deliveryDate",
  "hourSlot",
  "deliveryCount",
  "openCount",
  "openRate",
  "applyCount",
  "applyRate1",
  "applyRate2",
  "scoutNumber",
];

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

/** Candidate.name (フルネーム) から姓・名を推定して isForeignNg を呼ぶ */
function isForeigner(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  const parts = n.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return isForeignNg(parts[0], parts.slice(1).join(""));
  }
  // 単一トークンの場合は同じ値を姓名両方に入れて判定
  return isForeignNg(n, n);
}

function parseSortSpecs(searchParams: URLSearchParams): SortSpec[] {
  // 配列形式 sortBy[]=col:asc を試す
  const arr = searchParams.getAll("sortBy[]");
  // 通常の sortBy（カンマ区切り or 単一値）を取得
  const raw = arr.length > 0 ? arr : searchParams.getAll("sortBy");

  const specs: SortSpec[] = [];
  if (raw.length === 0) {
    // デフォルトは配信日降順 → 時間降順
    return [
      { column: "deliveryDate", order: "desc" },
      { column: "hourSlot", order: "desc" },
    ];
  }

  // 後方互換: ?sortBy=deliveryDate&sortOrder=desc（":"を含まず VALID_SORT_KEYS にあるなら単一指定）
  if (raw.length === 1 && !raw[0].includes(":") && !raw[0].includes(",")) {
    const col = raw[0] as SortKey;
    if (VALID_SORT_KEYS.includes(col)) {
      const order = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";
      return [{ column: col, order: order === "asc" ? "asc" : "desc" }];
    }
  }

  for (const entry of raw) {
    for (const piece of entry.split(",")) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const [colStr, orderStr] = trimmed.split(":");
      const col = colStr as SortKey;
      if (!VALID_SORT_KEYS.includes(col)) continue;
      const order = orderStr === "asc" ? "asc" : "desc";
      specs.push({ column: col, order });
    }
  }
  if (specs.length === 0) {
    return [
      { column: "deliveryDate", order: "desc" },
      { column: "hourSlot", order: "desc" },
    ];
  }
  return specs;
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
  const sortSpecs = parseSortSpecs(searchParams);

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
          select: { id: true, name: true, birthday: true, createdAt: true },
        },
      },
    });

    const rows = slots.map((slot) => {
      const ageGroups = { "20s": 0, "30s": 0, "40s": 0, "50s": 0, foreign: 0 };
      for (const c of slot.linkedCandidates) {
        // 外国籍判定（姓名がカタカナ/英字のみ → 外国籍）→ 年代カウントから除外
        if (isForeigner(c.name)) {
          ageGroups.foreign++;
          continue;
        }
        if (!c.birthday) continue;
        const age = ageAtDate(c.birthday, c.createdAt);
        if (age < 30) ageGroups["20s"]++;        // 「〜20代」: 30未満（19歳以下も含む）
        else if (age < 40) ageGroups["30s"]++;
        else if (age < 50) ageGroups["40s"]++;
        else ageGroups["50s"]++;                  // 「50代〜」: 50以上すべて
      }
      const applyCount = slot.linkedCandidates.length;
      const openRate = slot.deliveryCount > 0 ? (slot.openCount / slot.deliveryCount) * 100 : 0;
      const applyRate1 = slot.deliveryCount > 0 ? (applyCount / slot.deliveryCount) * 100 : 0;
      const applyRate2 = slot.openCount > 0 ? (applyCount / slot.openCount) * 100 : 0;
      const validApplyCount = ageGroups["20s"] + ageGroups["30s"];
      const invalidApplyCount = ageGroups["40s"] + ageGroups["50s"] + ageGroups.foreign;
      const validApplyRate = slot.deliveryCount > 0 ? (validApplyCount / slot.deliveryCount) * 100 : 0;
      const invalidApplyRate = slot.deliveryCount > 0 ? (invalidApplyCount / slot.deliveryCount) * 100 : 0;

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
        validApplyCount,
        invalidApplyCount,
        validApplyRate: Number(validApplyRate.toFixed(2)),
        invalidApplyRate: Number(invalidApplyRate.toFixed(2)),
      };
    });

    // 複合ソート（in-memory）
    type Row = typeof rows[number];
    function valueFor(r: Row, k: SortKey): string | number {
      switch (k) {
        case "deliveryCategoryLarge":
          return r.deliveryCategoryLarge;
        case "machineId":
          return r.machine?.recruiterName ?? "";
        case "deliveryDate":
          return `${r.deliveryDate}-${String(r.hourSlot).padStart(2, "0")}`;
        case "hourSlot":
          return r.hourSlot;
        case "deliveryCount":
          return r.deliveryCount;
        case "openCount":
          return r.openCount;
        case "openRate":
          return r.openRate;
        case "applyCount":
          return r.applyCount;
        case "applyRate1":
          return r.applyRate1;
        case "applyRate2":
          return r.applyRate2;
        case "scoutNumber":
          return r.scoutNumber;
      }
    }
    rows.sort((a, b) => {
      for (const spec of sortSpecs) {
        const dir = spec.order === "asc" ? 1 : -1;
        const av = valueFor(a, spec.column);
        const bv = valueFor(b, spec.column);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
      }
      return 0;
    });

    return NextResponse.json({ slots: rows, total: rows.length, sortSpecs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

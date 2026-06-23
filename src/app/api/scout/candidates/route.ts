/**
 * GET /api/scout/candidates
 *   ?slotId=...                          … 指定枠に紐づく応募者（配信枠管理の応募数と一致）
 *   ?date=YYYY-MM-DD[&media=..]          … 指定配信日の集計対象枠に紐づく応募者（配信日別集計 sent と一致）
 *   ?appliedDate=YYYY-MM-DD&from=..&to=..… 応募日別集計(applied)の指定応募日バケットの応募者と一致
 *                                          ※ stats の applied バケット基準（枠の先頭応募者 createdAt を
 *                                            UTC暦日で切る）に完全一致させる（罠#17 は集計に合わせ今回あえてUTC）
 *   ?from=..&to=..[&media=..][&machineLabel=..]
 *                                        … 期間内 集計対象枠の応募者（媒体別/アカウント別集計と一致）
 *
 * 数値クリック→応募者一覧用の read 専用API。既存集計（stats / slots/list）の定義に合わせる。
 * - 枠単位: isAggregationTarget を問わない（slots/list の applyCount と一致）
 * - 配信日/期間/媒体/アカウント単位: isAggregationTarget=true のみ（stats dateMode=sent の applyCount と一致）
 * 年代・外国籍・有効/無効区分の判定は slots/list/route.ts と同一ロジックを再利用。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";
import { isForeignNg } from "@/lib/mynavi-rpa/judgment";
import { Prisma } from "@prisma/client";

/** birthday と応募日(createdAt)から満年齢を算出（slots/list と同一） */
function ageAtDate(birthday: Date, at: Date): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const m = at.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birthday.getDate())) age--;
  return age;
}

/** Candidate.name から姓・名を推定して isForeignNg（slots/list と同一） */
function isForeigner(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  const parts = n.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return isForeignNg(parts[0], parts.slice(1).join(""));
  }
  return isForeignNg(n, n);
}

/** 罠#17: 表示用日付は JST 暦日 */
function jstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** stats の bucketKey(day) と同一の UTC暦日文字列（応募日別 applied バケット一致用・あえて UTC） */
function utcDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// モーダル表示に必要な Candidate フィールド（candidate findMany と slot.linkedCandidates で共用）
const CANDIDATE_SELECT = {
  id: true,
  candidateNumber: true,
  name: true,
  birthday: true,
  applicationDate: true,
  createdAt: true,
  recruiterName: true,
  masType: true,
  supportStatus: true,
  supportSubStatus: true,
} satisfies Prisma.CandidateSelect;

const MACHINE_SELECT = { recruiterName: true, machineNumber: true, isMachine: true } satisfies Prisma.ScoutMachineMasterSelect;

type CandRow = Prisma.CandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;
type SlotInfo = {
  deliveryCategoryLarge: string | null;
  deliveryCategoryMedium: string | null;
  deliveryCategorySmall: string | null;
  machine: Prisma.ScoutMachineMasterGetPayload<{ select: typeof MACHINE_SELECT }> | null;
};

/** 応募者1件 → モーダル行（年代/外国籍/有効無効の定義は slots/list と同一） */
function buildRow(c: CandRow, slot: SlotInfo | null) {
  const foreign = isForeigner(c.name);
  // 年代カウントは外国籍を除外（slots/list と同一）。生年月日なしは年代対象外。
  const age = !foreign && c.birthday ? ageAtDate(c.birthday, c.createdAt) : null;
  // 有効=〜20代+30代（age<40 かつ 非外国籍）/ 無効=40代+50代+外国籍 / 生年月日なし非外国籍は対象外("—")
  const category: "有効" | "無効" | "—" = foreign ? "無効" : age == null ? "—" : age < 40 ? "有効" : "無効";
  const appliedSrc = c.applicationDate ?? c.createdAt;
  return {
    id: c.id,
    candidateNumber: c.candidateNumber,
    name: c.name,
    age,
    isForeigner: foreign,
    category,
    appliedDate: appliedSrc ? jstYmd(appliedSrc) : null,
    recruiterName: c.recruiterName,
    masType: c.masType,
    machine: slot?.machine
      ? { recruiterName: slot.machine.recruiterName, machineNumber: slot.machine.machineNumber, isMachine: slot.machine.isMachine }
      : null,
    deliveryCategoryLarge: slot?.deliveryCategoryLarge ?? null,
    deliveryCategoryMedium: slot?.deliveryCategoryMedium ?? null,
    deliveryCategorySmall: slot?.deliveryCategorySmall ?? null,
    supportStatus: c.supportStatus,
    supportSubStatus: c.supportSubStatus,
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const slotId = searchParams.get("slotId");
  const dateStr = searchParams.get("date");
  const appliedDate = searchParams.get("appliedDate");
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const media = searchParams.get("media");
  const machineLabel = searchParams.get("machineLabel");

  // ---- 応募日別 applied バケット（stats と完全一致・あえて UTC暦日基準）----
  if (appliedDate) {
    if (!fromStr || !toStr) {
      return NextResponse.json({ error: "appliedDate には from/to が必要です" }, { status: 400 });
    }
    let fromD: Date, toD: Date;
    try {
      fromD = parseSlotDate(fromStr);
      toD = parseSlotDate(toStr);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    // stats と同一: deliveryDate 範囲・isAggregationTarget の枠を取得し、linkedCandidates[0].createdAt の
    // UTC暦日 == appliedDate の枠の応募者を全件返す（先頭応募者の日付で枠ごと寄せる stats 挙動を再現）。
    const slots = await prisma.scoutDeliverySlot.findMany({
      where: { deliveryDate: { gte: fromD, lte: toD }, isAggregationTarget: true },
      select: {
        deliveryDate: true,
        deliveryCategoryLarge: true,
        deliveryCategoryMedium: true,
        deliveryCategorySmall: true,
        machine: { select: MACHINE_SELECT },
        linkedCandidates: { select: CANDIDATE_SELECT },
      },
    });
    const rows: ReturnType<typeof buildRow>[] = [];
    for (const slot of slots) {
      const dateForBucket = slot.linkedCandidates[0]?.createdAt ?? slot.deliveryDate;
      if (utcDay(dateForBucket) !== appliedDate) continue;
      for (const c of slot.linkedCandidates) rows.push(buildRow(c, slot));
    }
    rows.sort((a, b) => (a.appliedDate ?? "").localeCompare(b.appliedDate ?? ""));
    return NextResponse.json({ candidates: rows, total: rows.length });
  }

  // ---- 枠 / 配信日 / 期間（媒体・アカウント）----
  const where: Prisma.CandidateWhereInput = {};
  if (slotId) {
    // 枠単位: その枠に紐づく応募者（集計対象フラグは問わない）
    where.scoutDeliverySlotId = slotId;
  } else if (dateStr) {
    // 配信日単位: 集計対象枠のみ
    let date: Date;
    try {
      date = parseSlotDate(dateStr);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    where.scoutDeliverySlot = { is: { deliveryDate: date, isAggregationTarget: true, ...(media ? { mediaSource: media } : {}) } };
  } else if (fromStr && toStr) {
    // 期間単位（媒体別/アカウント別）: 集計対象枠のみ。media / machineLabel で絞る。
    let fromD: Date, toD: Date;
    try {
      fromD = parseSlotDate(fromStr);
      toD = parseSlotDate(toStr);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    const slotFilter: Prisma.ScoutDeliverySlotWhereInput = {
      deliveryDate: { gte: fromD, lte: toD },
      isAggregationTarget: true,
      ...(media ? { mediaSource: media } : {}),
    };
    if (machineLabel) {
      // stats axis=machine は machine.machineLabel でグルーピング（"未割当"=machine 無し）。
      slotFilter.machine = machineLabel === "未割当" ? { is: null } : { is: { machineLabel } };
    }
    where.scoutDeliverySlot = { is: slotFilter };
  } else {
    return NextResponse.json({ error: "slotId / date / appliedDate / (from & to) のいずれかが必要です" }, { status: 400 });
  }

  const candidates = await prisma.candidate.findMany({
    where,
    select: {
      ...CANDIDATE_SELECT,
      scoutDeliverySlot: {
        select: {
          deliveryCategoryLarge: true,
          deliveryCategoryMedium: true,
          deliveryCategorySmall: true,
          machine: { select: MACHINE_SELECT },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = candidates.map((c) => {
    const { scoutDeliverySlot, ...cand } = c;
    return buildRow(cand, scoutDeliverySlot);
  });

  return NextResponse.json({ candidates: rows, total: rows.length });
}

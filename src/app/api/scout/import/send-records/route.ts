import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";

/**
 * POST /api/scout/import/send-records
 * T-067 Phase B-1: スカウト配信明細（会員No・配信日・担当者・号機）を RPA から受け取り保存。
 * - 認証: x-rpa-secret（既存の verifyRpaSecret を流用）。
 * - 冪等: @@unique([memberNo, deliveryDate, machineNumber]) で重複なら更新・無ければ作成（upsert）。
 * - 既存の件数集計（/api/scout/import/aggregated・ScoutDeliverySlot）とは完全に別系統（非干渉）。
 *
 * body: { records: [{ memberNo, deliveryDate("YYYY-MM-DD"), recruiterName?, machineNumber? }] }
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RecordInput = {
  memberNo?: unknown;
  deliveryDate?: unknown;
  recruiterName?: unknown;
  machineNumber?: unknown;
};

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { records?: unknown };
  try {
    body = (await req.json()) as { records?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const records: RecordInput[] = Array.isArray(body.records) ? (body.records as RecordInput[]) : [];
  const received = records.length;
  let upserted = 0;
  let skipped = 0;

  for (const r of records) {
    const memberNo = typeof r.memberNo === "string" ? r.memberNo.trim() : "";
    const deliveryDateStr = typeof r.deliveryDate === "string" ? r.deliveryDate.trim() : "";
    // 必須欠落・日付形式不正はスキップ（落とさず1件だけ無視）
    if (!memberNo || !DATE_RE.test(deliveryDateStr)) {
      skipped++;
      continue;
    }
    const recruiterName =
      typeof r.recruiterName === "string" && r.recruiterName.trim() ? r.recruiterName.trim() : null;
    // 1〜5 の範囲外は null 扱い（落とさない）
    const mnRaw = typeof r.machineNumber === "number" ? r.machineNumber : Number(r.machineNumber);
    const machineNumber = Number.isInteger(mnRaw) && mnRaw >= 1 && mnRaw <= 5 ? mnRaw : null;

    let deliveryDate: Date;
    try {
      deliveryDate = parseSlotDate(deliveryDateStr); // 罠#17: Date.UTC ベース（@db.Date 用）
    } catch {
      skipped++;
      continue;
    }

    try {
      // machineNumber が null の場合 compound-unique(NULL) の ON CONFLICT が効かないため、
      // findFirst → update/create で確実に冪等化する。
      const existing = await prisma.scoutSendRecord.findFirst({
        where: { memberNo, deliveryDate, machineNumber },
        select: { id: true },
      });
      if (existing) {
        await prisma.scoutSendRecord.update({
          where: { id: existing.id },
          data: { recruiterName },
        });
      } else {
        await prisma.scoutSendRecord.create({
          data: { memberNo, deliveryDate, recruiterName, machineNumber },
        });
      }
      upserted++;
    } catch (e) {
      console.error("[ScoutSendRecord] upsert failed:", e);
      skipped++;
    }
  }

  console.log(`[ScoutSendRecord] received=${received} upserted=${upserted} skipped=${skipped}`);
  return NextResponse.json({ received, upserted, skipped });
}

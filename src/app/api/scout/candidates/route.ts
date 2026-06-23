/**
 * GET /api/scout/candidates
 *   ?slotId=...                 … 指定枠に紐づく応募者（配信枠管理の応募数と一致）
 *   ?date=YYYY-MM-DD[&media=..] … 指定配信日の集計対象枠に紐づく応募者（配信日別集計の応募数と一致）
 *
 * 数値クリック→応募者一覧用の read 専用API。既存集計（stats / slots/list）の定義に合わせる。
 * - 枠単位: isAggregationTarget を問わない（slots/list の applyCount と一致）
 * - 配信日単位: isAggregationTarget=true のみ（stats dateMode=sent の applyCount と一致）
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

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const slotId = searchParams.get("slotId");
  const dateStr = searchParams.get("date");
  const media = searchParams.get("media");

  if (!slotId && !dateStr) {
    return NextResponse.json({ error: "slotId または date が必要です" }, { status: 400 });
  }

  const where: Prisma.CandidateWhereInput = {};
  if (slotId) {
    // 枠単位: その枠に紐づく応募者（集計対象フラグは問わない）
    where.scoutDeliverySlotId = slotId;
  } else {
    // 配信日単位: 集計対象枠のみ（配信日別集計の数と一致）
    let date: Date;
    try {
      date = parseSlotDate(dateStr!);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
    where.scoutDeliverySlot = {
      is: {
        deliveryDate: date,
        isAggregationTarget: true,
        ...(media ? { mediaSource: media } : {}),
      },
    };
  }

  const candidates = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      birthday: true,
      applicationDate: true,
      createdAt: true,
      recruiterName: true,
      supportStatus: true,
      supportSubStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = candidates.map((c) => {
    const foreign = isForeigner(c.name);
    // 年代カウントは外国籍を除外（slots/list と同一）。生年月日なしは年代対象外。
    const age = !foreign && c.birthday ? ageAtDate(c.birthday, c.createdAt) : null;
    // 有効=〜20代+30代（age<40 かつ 非外国籍）/ 無効=40代+50代+外国籍 / 生年月日なし非外国籍は対象外("—")
    const category: "有効" | "無効" | "—" = foreign
      ? "無効"
      : age == null
        ? "—"
        : age < 40
          ? "有効"
          : "無効";
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
      supportStatus: c.supportStatus,
      supportSubStatus: c.supportSubStatus,
    };
  });

  return NextResponse.json({ candidates: rows, total: rows.length });
}

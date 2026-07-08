import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { applyEntryFlagAutoTransitions } from "@/lib/constants/entry-flag-rules";
import { resolveEntryIsActive } from "@/lib/entries/resolveEntryIsActive";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { entryIds, entryFlag, entryFlagDetail, companyFlag, personFlag } = body as {
    entryIds: string[];
    entryFlag?: string | null;
    entryFlagDetail?: string | null;
    companyFlag?: string | null;
    personFlag?: string | null;
  };

  if (!entryIds?.length) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }

  // Build update data (only non-null fields)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  if (entryFlag !== undefined && entryFlag !== null) data.entryFlag = entryFlag;
  if (entryFlagDetail !== undefined && entryFlagDetail !== null) data.entryFlagDetail = entryFlagDetail;
  if (companyFlag !== undefined && companyFlag !== null) data.companyFlag = companyFlag;
  if (personFlag !== undefined && personFlag !== null) data.personFlag = personFlag;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No flags to update" }, { status: 400 });
  }

  // T-140: is_active はエントリーごとに「リクエスト値 ?? 既存値」でマージして双方向再計算する。
  // updateMany では各エントリーの既存フラグ（今回更新しないフラグ）を参照できず、既存の
  // 無効化要因を無視して誤って有効化してしまうため、per-entry の update に切り替える。
  const affectedEntries = await prisma.jobEntry.findMany({
    where: { id: { in: entryIds } },
    select: { id: true, candidateId: true, entryFlag: true, entryFlagDetail: true, companyFlag: true, personFlag: true },
  });
  const uniqueCandidateIds = [...new Set(affectedEntries.map((e) => e.candidateId))];

  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const e of affectedEntries) {
      // 更新後の最終フラグ = リクエスト値（data に載る）?? 既存値。入社済遷移も反映。
      const merged = applyEntryFlagAutoTransitions({
        entryFlag: "entryFlag" in data ? data.entryFlag : e.entryFlag,
        entryFlagDetail: "entryFlagDetail" in data ? data.entryFlagDetail : e.entryFlagDetail,
        companyFlag: "companyFlag" in data ? data.companyFlag : e.companyFlag,
        personFlag: "personFlag" in data ? data.personFlag : e.personFlag,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perData: Record<string, any> = { ...data };
      // 入社済遷移で entryFlag/entryFlagDetail が書き換わった分だけ追加反映する。
      if (merged.entryFlag !== e.entryFlag) perData.entryFlag = merged.entryFlag;
      if (merged.entryFlagDetail !== e.entryFlagDetail) perData.entryFlagDetail = merged.entryFlagDetail;
      perData.isActive = resolveEntryIsActive({
        entryFlag: merged.entryFlag,
        entryFlagDetail: merged.entryFlagDetail,
        companyFlag: merged.companyFlag,
        personFlag: merged.personFlag,
      });
      await tx.jobEntry.update({ where: { id: e.id }, data: perData });
      updatedCount++;
    }
  });
  const result = { count: updatedCount };

  for (const candidateId of uniqueCandidateIds) {
    try {
      await recalculateSubStatusIfAuto(candidateId);
    } catch (e) {
      console.error("[bulk-flags.PATCH] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json({
    updated: result.count,
    message: `${result.count}件のフラグを変更しました`,
  });
}

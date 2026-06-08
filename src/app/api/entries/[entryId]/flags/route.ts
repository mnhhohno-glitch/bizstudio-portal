import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { PERSON_FLAG_RULES, COMPANY_FLAG_RULES, INACTIVE_TRIGGERS, applyEntryFlagAutoTransitions } from "@/lib/constants/entry-flag-rules";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
import { jstDateStringToDbDate, todayJstDateString } from "@/lib/dailyReport/jstDate";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const body = await req.json();
  const { entryFlag, entryFlagDetail, companyFlag, personFlag } = body as {
    entryFlag?: string;
    entryFlagDetail?: string;
    companyFlag?: string | null;
    personFlag?: string | null;
  };

  // Validate person/company flags against rules
  const effectiveEntryFlag = entryFlag || (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { entryFlag: true } }))?.entryFlag || "";

  if (personFlag && effectiveEntryFlag) {
    const allowed = PERSON_FLAG_RULES[effectiveEntryFlag] || [];
    if (!allowed.includes(personFlag)) {
      return NextResponse.json({ error: `「${personFlag}」は「${effectiveEntryFlag}」では使用できません` }, { status: 400 });
    }
  }

  if (companyFlag && effectiveEntryFlag) {
    const allowed = COMPANY_FLAG_RULES[effectiveEntryFlag] || [];
    if (!allowed.includes(companyFlag)) {
      return NextResponse.json({ error: `「${companyFlag}」は「${effectiveEntryFlag}」では使用できません` }, { status: 400 });
    }
  }

  // Determine isActive based on flags
  const effectivePersonFlag = personFlag !== undefined ? personFlag : (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { personFlag: true } }))?.personFlag;
  const effectiveCompanyFlag = companyFlag !== undefined ? companyFlag : (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { companyFlag: true } }))?.companyFlag;
  const effectiveEntryFlagDetail = entryFlagDetail !== undefined ? entryFlagDetail : (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { entryFlagDetail: true } }))?.entryFlagDetail;

  let isActive = true;
  if (effectivePersonFlag && INACTIVE_TRIGGERS.personFlags.includes(effectivePersonFlag)) {
    isActive = false;
  }
  if (effectiveCompanyFlag && INACTIVE_TRIGGERS.companyFlags.includes(effectiveCompanyFlag)) {
    isActive = false;
  }
  if (effectiveEntryFlagDetail && INACTIVE_TRIGGERS.entryFlagDetails.includes(effectiveEntryFlagDetail)) {
    isActive = false; // T-048: 本人辞退時に自動無効化
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { isActive };
  if (entryFlag !== undefined) data.entryFlag = entryFlag;
  if (entryFlagDetail !== undefined) data.entryFlagDetail = entryFlagDetail;
  if (companyFlag !== undefined) data.companyFlag = companyFlag;
  if (personFlag !== undefined) data.personFlag = personFlag;

  // 段階日付の自動入力：フラグが進んだとき、対応する日付欄が空なら JST 当日をセットする。
  //  - entryFlag が「書類選考」に変わったとき → 書類提出日（提出して書類選考フェーズに入った日）
  //  - entryFlag が「面接 / 内定 / 入社済」に変わったとき → 書類通過日（面接以降＝書類は通過済み）
  //  - entryFlag が「内定」に変わったとき → 内定日
  //  - entryFlagDetail が「承諾」に変わったとき → 承諾日
  // ただし既存値が入っているレコードは上書きしない（手入力値を保護）。
  // JST 当日は jstDateStringToDbDate(todayJstDateString()) で UTC midnight Date に変換
  // （他の日付フィールドの保存規約と同じ。toISOString().slice(0,10) は使わない）。
  const reachedInterviewOrBeyond = entryFlag === "面接" || entryFlag === "内定" || entryFlag === "入社済";
  const reachedDocReview = entryFlag === "書類選考";
  if (reachedDocReview || reachedInterviewOrBeyond || entryFlag === "内定" || entryFlagDetail === "承諾") {
    const existing = await prisma.jobEntry.findUnique({
      where: { id: entryId },
      select: { documentSubmitDate: true, documentPassDate: true, offerDate: true, acceptanceDate: true },
    });
    const today = jstDateStringToDbDate(todayJstDateString());
    if (reachedDocReview && existing && existing.documentSubmitDate == null) {
      data.documentSubmitDate = today;
    }
    if (reachedInterviewOrBeyond && existing && existing.documentPassDate == null) {
      data.documentPassDate = today;
    }
    if (entryFlag === "内定" && existing && existing.offerDate == null) {
      data.offerDate = today;
    }
    if (entryFlagDetail === "承諾" && existing && existing.acceptanceDate == null) {
      data.acceptanceDate = today;
    }
  }

  const transformedData = applyEntryFlagAutoTransitions(data);

  const entry = await prisma.jobEntry.update({
    where: { id: entryId },
    data: transformedData,
    include: {
      candidate: {
        select: {
          id: true,
          name: true,
          candidateNumber: true,
          employeeId: true,
          employee: { select: { name: true } },
        },
      },
    },
  });

  if ("entryFlag" in transformedData || "personFlag" in transformedData) {
    try {
      await recalculateSubStatusIfAuto(entry.candidateId);
    } catch (e) {
      console.error("[flags.PATCH] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json({ entry });
}

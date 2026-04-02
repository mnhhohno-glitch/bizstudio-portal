import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { PERSON_FLAG_RULES, COMPANY_FLAG_RULES, INACTIVE_TRIGGERS } from "@/lib/constants/entry-flag-rules";
import { checkAutoSupportEnd } from "@/lib/support-status-auto";

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

  let isActive = true;
  if (effectivePersonFlag && INACTIVE_TRIGGERS.personFlags.includes(effectivePersonFlag)) {
    isActive = false;
  }
  if (effectiveCompanyFlag && INACTIVE_TRIGGERS.companyFlags.includes(effectiveCompanyFlag)) {
    isActive = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { isActive };
  if (entryFlag !== undefined) data.entryFlag = entryFlag;
  if (entryFlagDetail !== undefined) data.entryFlagDetail = entryFlagDetail;
  if (companyFlag !== undefined) data.companyFlag = companyFlag;
  if (personFlag !== undefined) data.personFlag = personFlag;

  const entry = await prisma.jobEntry.update({
    where: { id: entryId },
    data,
    include: {
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
  });

  // Auto-linkage: check if candidate should be auto-ended
  try {
    await checkAutoSupportEnd(
      entry.candidate.id,
      entryFlag || entry.entryFlag || null,
      entryFlagDetail || entry.entryFlagDetail || null,
      personFlag !== undefined ? personFlag : entry.personFlag || null
    );
  } catch (e) {
    console.error("[Flags] Auto support end check failed:", e);
  }

  return NextResponse.json({ entry });
}

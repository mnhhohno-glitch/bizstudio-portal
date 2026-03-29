import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { INACTIVE_TRIGGERS } from "@/lib/constants/entry-flag-rules";

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

  // Determine isActive based on new flags
  const effectivePersonFlag = data.personFlag;
  const effectiveCompanyFlag = data.companyFlag;

  let shouldDeactivate = false;
  if (effectivePersonFlag && INACTIVE_TRIGGERS.personFlags.includes(effectivePersonFlag)) {
    shouldDeactivate = true;
  }
  if (effectiveCompanyFlag && INACTIVE_TRIGGERS.companyFlags.includes(effectiveCompanyFlag)) {
    shouldDeactivate = true;
  }

  if (shouldDeactivate) {
    data.isActive = false;
  }

  const result = await prisma.jobEntry.updateMany({
    where: { id: { in: entryIds } },
    data,
  });

  return NextResponse.json({
    updated: result.count,
    message: `${result.count}件のフラグを変更しました`,
  });
}

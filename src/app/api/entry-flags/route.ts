import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { PERSON_FLAG_RULES, COMPANY_FLAG_RULES } from "@/lib/constants/entry-flag-rules";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const flags = await prisma.entryFlagMaster.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  const entryFlags = flags
    .filter((f) => f.flagType === "entry")
    .map((f) => f.value);

  const entryDetails: Record<string, string[]> = {};
  for (const f of flags.filter((f) => f.flagType === "entry_detail")) {
    const parent = f.parentFlag || "";
    if (!entryDetails[parent]) entryDetails[parent] = [];
    entryDetails[parent].push(f.value);
  }

  return NextResponse.json({
    entryFlags,
    entryDetails,
    personFlags: PERSON_FLAG_RULES,
    companyFlags: COMPANY_FLAG_RULES,
  });
}

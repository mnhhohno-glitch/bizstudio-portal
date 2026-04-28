import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type UpdateItem = {
  id: string;
  entryFlagDetail: string;
  companyFlag: string;
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { updates } = (await req.json()) as { updates: UpdateItem[] };
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ updatedIds: [] });
  }

  const updatedIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.jobEntry.update({
        where: { id: u.id },
        data: {
          entryFlagDetail: u.entryFlagDetail,
          companyFlag: u.companyFlag,
        },
      });
      updatedIds.push(u.id);
    }
  });

  return NextResponse.json({ updatedIds });
}

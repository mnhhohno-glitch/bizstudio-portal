import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: Request) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { keywords } = await req.json();

  if (!keywords?.length) {
    return NextResponse.json({ hasDuplicate: false, duplicates: [] });
  }

  const existingErrors = await prisma.rpaKnownError.findMany({
    select: { id: true, patternName: true, keywords: true },
  });

  const lowerKeywords = keywords.map((k: string) => k.toLowerCase());

  const duplicates = existingErrors
    .map((e) => {
      const matchedKeywords = e.keywords.filter((ek) =>
        lowerKeywords.includes(ek.toLowerCase())
      );
      return {
        id: e.id,
        patternName: e.patternName,
        matchedKeywords,
        matchCount: matchedKeywords.length,
      };
    })
    .filter((d) => d.matchCount >= 2);

  return NextResponse.json({
    hasDuplicate: duplicates.length > 0,
    duplicates,
  });
}

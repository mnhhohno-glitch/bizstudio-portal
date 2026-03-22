import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { patternName, keywords, solution, solutionUrl, severity } = await req.json();

  await prisma.rpaKnownError.update({
    where: { id },
    data: {
      ...(patternName !== undefined && { patternName }),
      ...(keywords !== undefined && { keywords }),
      ...(solution !== undefined && { solution }),
      ...(solutionUrl !== undefined && { solutionUrl: solutionUrl || null }),
      ...(severity !== undefined && { severity }),
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.rpaKnownError.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

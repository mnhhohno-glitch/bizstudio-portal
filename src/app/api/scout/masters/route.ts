/**
 * GET /api/scout/masters
 *   returns: { machines: ScoutMachineMaster[], media: ScoutMediaMaster[] }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const [machines, media] = await Promise.all([
    prisma.scoutMachineMaster.findMany({
      orderBy: [{ isMachine: "desc" }, { machineNumber: "asc" }, { recruiterName: "asc" }],
    }),
    prisma.scoutMediaMaster.findMany({
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  return NextResponse.json({ machines, media });
}

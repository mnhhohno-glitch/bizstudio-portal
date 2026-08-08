import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 号機一覧＋各号機の最新ログ（状況ボード用）。「現在の設定」は最新の RpaScoutLog で表現する
export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const machines = await prisma.rpaScoutMachine.findMany({
    orderBy: { machineNo: "asc" },
  });

  const latestLogs = await Promise.all(
    machines.map((m) =>
      prisma.rpaScoutLog.findFirst({
        where: { machineNo: m.machineNo },
        orderBy: { recordedAt: "desc" },
      })
    )
  );

  const userIds = Array.from(
    new Set(latestLogs.map((l) => l?.recordedByUserId).filter((v): v is string => !!v))
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userNameMap = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));

  return NextResponse.json({
    machines: machines.map((m, i) => {
      const log = latestLogs[i];
      return {
        ...m,
        latestLog: log
          ? {
              ...log,
              recordedByName: log.recordedByUserId
                ? (userNameMap[log.recordedByUserId] ?? null)
                : null,
            }
          : null,
      };
    }),
  });
}

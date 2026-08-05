import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const DEFAULT_WORK_KEY = "work0-shokushu-gyoshu";

// 記述式ワークの管理用集計（admin のみ）
// 設問一覧・全社員の回答・アクティブ社員一覧を返し、マトリクス/全文表示/④一覧はクライアントで組み立てる
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const workKey = request.nextUrl.searchParams.get("workKey") || DEFAULT_WORK_KEY;

  const [items, answers, activeUsers, workKeyRows] = await Promise.all([
    prisma.trainingWorkItem.findMany({
      where: { workKey, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, itemCode: true, sortOrder: true, title: true, jobContent: true },
    }),
    prisma.trainingWorkAnswer.findMany({
      where: { workKey },
      orderBy: { updatedAt: "desc" },
      select: {
        employeeId: true,
        itemCode: true,
        answerCompany: true,
        answerHelp: true,
        answerDay: true,
        answerUnknown: true,
        updatedAt: true,
      },
    }),
    prisma.user.findMany({
      where: { status: "active" },
      orderBy: [{ employeeNumber: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.trainingWorkItem.findMany({
      distinct: ["workKey"],
      select: { workKey: true },
      orderBy: { workKey: "asc" },
    }),
  ]);

  // User モデルへのリレーションは張っていないため、名前はここで合流させる
  // 退職者（active 以外）の回答も表示できるよう、回答者の employeeId は別途引く
  const activeIds = new Set(activeUsers.map((u) => u.id));
  const extraIds = [...new Set(answers.map((a) => a.employeeId))].filter((id) => !activeIds.has(id));
  const extraUsers =
    extraIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: extraIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const nameById = new Map(
    [...activeUsers, ...extraUsers].map((u) => [u.id, u.name ?? u.email])
  );

  return NextResponse.json({
    workKey,
    workKeys: workKeyRows.map((r) => r.workKey),
    items,
    employees: activeUsers.map((u) => ({ id: u.id, name: u.name ?? u.email })),
    answers: answers.map((a) => ({
      ...a,
      employeeName: nameById.get(a.employeeId) ?? "不明",
    })),
  });
}

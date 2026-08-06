import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { normalizeFieldLabels } from "@/lib/training-work";

// 記述式ワークの管理用集計（admin のみ）
// ワーク定義・設問一覧・全社員の回答・アクティブ社員一覧を返し、
// マトリクス/全文表示/④一覧はクライアントで組み立てる
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sets = await prisma.trainingWorkSet.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { workKey: true, title: true, fieldLabels: true },
  });

  const requested = request.nextUrl.searchParams.get("workKey");
  const current = sets.find((s) => s.workKey === requested) ?? sets[0] ?? null;
  const workKey = current?.workKey ?? requested ?? "";

  const [items, answers, activeUsers] = await Promise.all([
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
        createdAt: true, // 研修日の絞り込み用（JST 変換はクライアント側）
        updatedAt: true,
      },
    }),
    prisma.user.findMany({
      where: { status: "active" },
      orderBy: [{ employeeNumber: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, name: true, email: true },
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
    sets: sets.map((s) => ({
      workKey: s.workKey,
      title: s.title,
      fieldLabels: normalizeFieldLabels(s.fieldLabels),
    })),
    fieldLabels: current ? normalizeFieldLabels(current.fieldLabels) : [],
    items,
    employees: activeUsers.map((u) => ({ id: u.id, name: u.name ?? u.email })),
    answers: answers.map((a) => ({
      ...a,
      employeeName: nameById.get(a.employeeId) ?? "不明",
    })),
  });
}

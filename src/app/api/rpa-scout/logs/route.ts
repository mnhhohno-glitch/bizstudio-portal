import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { jstStringToDbDate } from "@/lib/rpa-scout/jst";

export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = 50;
  const machineNo = sp.get("machineNo") ? parseInt(sp.get("machineNo")!, 10) : null;
  const from = sp.get("from"); // "YYYY-MM-DD"（JST）
  const to = sp.get("to");
  const patternName = sp.get("patternName");
  const sort = sp.get("sort") || "recordedAt"; // recordedAt | machineNo | searchCount
  const order = sp.get("order") === "asc" ? "asc" : "desc";

  const where: Prisma.RpaScoutLogWhereInput = {};
  if (machineNo != null && Number.isFinite(machineNo)) where.machineNo = machineNo;
  if (from || to) {
    where.recordedAt = {};
    // recordedAt はJST壁時計値をそのまま保持しているため、JST文字列をそのまま境界にする（罠#17）
    if (from) where.recordedAt.gte = jstStringToDbDate(from);
    if (to) where.recordedAt.lt = jstStringToDbDate(to + "T23:59:59");
  }
  if (patternName) where.patternName = { contains: patternName };

  const orderBy: Prisma.RpaScoutLogOrderByWithRelationInput[] =
    sort === "machineNo"
      ? [{ machineNo: order }, { recordedAt: "desc" }]
      : sort === "searchCount"
        ? [{ searchCount: { sort: order, nulls: "last" } }, { recordedAt: "desc" }]
        : [{ recordedAt: order }];

  const [logs, total] = await Promise.all([
    prisma.rpaScoutLog.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.rpaScoutLog.count({ where }),
  ]);

  const userIds = Array.from(
    new Set(logs.map((l) => l.recordedByUserId).filter((v): v is string => !!v))
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userNameMap = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));

  return NextResponse.json({
    logs: logs.map((l) => ({
      ...l,
      recordedByName: l.recordedByUserId ? (userNameMap[l.recordedByUserId] ?? null) : null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

// 状況ボードの「更新」→ 変更ログを1レコードINSERT
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const machineNo = typeof body.machineNo === "number" ? body.machineNo : null;
  if (machineNo == null || machineNo < 1 || machineNo > 6)
    return NextResponse.json({ error: "号機が不正です" }, { status: 400 });
  if (typeof body.patternId !== "string" || !body.patternId)
    return NextResponse.json({ error: "パターンを選択してください" }, { status: 400 });
  if (typeof body.subjectTemplateId !== "string" || !body.subjectTemplateId)
    return NextResponse.json({ error: "件名テンプレートを選択してください" }, { status: 400 });
  if (typeof body.recordedAt !== "string" || !body.recordedAt)
    return NextResponse.json({ error: "記録日時を入力してください" }, { status: 400 });

  const searchCount =
    typeof body.searchCount === "number" && Number.isFinite(body.searchCount)
      ? Math.trunc(body.searchCount)
      : null; // 空欄=停止記録

  const [pattern, template] = await Promise.all([
    prisma.rpaScoutPattern.findUnique({ where: { id: body.patternId } }),
    prisma.rpaScoutSubjectTemplate.findUnique({ where: { id: body.subjectTemplateId } }),
  ]);
  if (!pattern)
    return NextResponse.json({ error: "パターンが見つかりません" }, { status: 404 });
  if (!template)
    return NextResponse.json({ error: "件名テンプレートが見つかりません" }, { status: 404 });

  let recordedAt: Date;
  try {
    // "YYYY-MM-DDTHH:mm"（JST壁時計）をそのままDBへ（罠#17: UTC変換しない）
    recordedAt = jstStringToDbDate(body.recordedAt);
  } catch {
    return NextResponse.json({ error: "記録日時の形式が不正です" }, { status: 400 });
  }

  const log = await prisma.rpaScoutLog.create({
    data: {
      machineNo,
      patternId: pattern.id,
      patternName: pattern.name, // スナップショット
      subjectTemplateId: template.id,
      subjectName: template.name, // スナップショット
      searchCount,
      recordedAt,
      recordedByUserId: actor.id,
    },
  });

  return NextResponse.json({ log });
}

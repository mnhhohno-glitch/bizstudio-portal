import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { normalizeFieldLabels } from "@/lib/training-work";

// ワーク一覧 + 選択中ワークの設問一覧 + ログインユーザー本人の回答を返す
// （middleware は /api/ を素通しするためここで認証する）
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sets = await prisma.trainingWorkSet.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { workKey: true, title: true, description: true, fieldLabels: true, sortOrder: true },
  });

  const requested = request.nextUrl.searchParams.get("workKey");
  // 未指定・不正な workKey は先頭のワークにフォールバックする
  const current = sets.find((s) => s.workKey === requested) ?? sets[0] ?? null;
  if (!current) {
    return NextResponse.json({ sets: [], set: null, workKey: null, items: [], answers: [] });
  }

  const [items, answers] = await Promise.all([
    prisma.trainingWorkItem.findMany({
      where: { workKey: current.workKey, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        itemCode: true,
        sortOrder: true,
        title: true,
        jobContent: true,
        hintNote: true,
      },
    }),
    prisma.trainingWorkAnswer.findMany({
      where: { workKey: current.workKey, employeeId: actor.id },
      select: {
        itemCode: true,
        answerCompany: true,
        answerHelp: true,
        answerDay: true,
        answerUnknown: true,
        updatedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    sets: sets.map((s) => ({
      workKey: s.workKey,
      title: s.title,
      description: s.description,
      fieldLabels: normalizeFieldLabels(s.fieldLabels),
    })),
    workKey: current.workKey,
    set: {
      workKey: current.workKey,
      title: current.title,
      description: current.description,
      fieldLabels: normalizeFieldLabels(current.fieldLabels),
    },
    items,
    answers,
  });
}

// 回答の保存（[employeeId, workKey, itemCode] で upsert）
// employeeId はセッションから取得する。body からは受け取らない
// リクエスト形式は既存のまま（そのワークで使わない欄は空文字が入る）
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  }

  const { workKey, itemCode, answerCompany, answerHelp, answerDay, answerUnknown } = body;

  if (typeof workKey !== "string" || workKey.length === 0) {
    return NextResponse.json({ error: "workKey は必須です" }, { status: 400 });
  }
  if (typeof itemCode !== "string" || itemCode.length === 0) {
    return NextResponse.json({ error: "itemCode は必須です" }, { status: 400 });
  }
  for (const [name, v] of [
    ["answerCompany", answerCompany],
    ["answerHelp", answerHelp],
    ["answerDay", answerDay],
    ["answerUnknown", answerUnknown],
  ] as const) {
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `${name} の形式が不正です` }, { status: 400 });
    }
  }

  const answers = {
    answerCompany: typeof answerCompany === "string" ? answerCompany.trim() : "",
    answerHelp: typeof answerHelp === "string" ? answerHelp.trim() : "",
    answerDay: typeof answerDay === "string" ? answerDay.trim() : "",
    answerUnknown: typeof answerUnknown === "string" ? answerUnknown.trim() : "",
  };
  if (Object.values(answers).every((v) => v.length === 0)) {
    return NextResponse.json({ error: "少なくとも1つの欄を入力してください" }, { status: 400 });
  }

  // 存在しない設問への回答は弾く
  const item = await prisma.trainingWorkItem.findUnique({
    where: { workKey_itemCode: { workKey, itemCode } },
    select: { id: true, isActive: true },
  });
  if (!item || !item.isActive) {
    return NextResponse.json({ error: "存在しない設問です" }, { status: 400 });
  }

  const saved = await prisma.trainingWorkAnswer.upsert({
    where: {
      employeeId_workKey_itemCode: { employeeId: actor.id, workKey, itemCode },
    },
    update: answers,
    create: { employeeId: actor.id, workKey, itemCode, ...answers },
  });

  return NextResponse.json({ id: saved.id, itemCode: saved.itemCode, updatedAt: saved.updatedAt });
}

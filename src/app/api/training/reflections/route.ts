import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const VALID_RATINGS = ["A", "B", "C", "D"];

// JST の当日日付文字列（罠#17: Railway 本番は UTC のため toISOString 由来は使わない）
function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// 当日分の作成・更新（upsert）: ログイン済み全員
// reportDate はリクエストから受け取らず、サーバー側で JST 当日を算出する
// isDraft: true は下書き（必須チェックなし）、false は提出（必須3項目チェック + submittedAt 記録）
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  }

  const {
    learned,
    confused,
    questions,
    freeNote,
    dayLabel,
    workJobCount,
    workCorrectCount,
    workTarget,
    workMistake,
    workNextTime,
    observeScene,
    observeHard,
    isDraft,
    checkAnswers,
  } = body;

  const draft = isDraft === true;

  // 型チェック（下書きでも型が壊れた値は保存しない）
  for (const [name, v] of [
    ["learned", learned],
    ["confused", confused],
    ["questions", questions],
    ["freeNote", freeNote],
    ["dayLabel", dayLabel],
    ["workTarget", workTarget],
    ["workMistake", workMistake],
    ["workNextTime", workNextTime],
    ["observeScene", observeScene],
    ["observeHard", observeHard],
  ] as const) {
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `${name} の形式が不正です` }, { status: 400 });
    }
  }
  for (const [name, v] of [
    ["workJobCount", workJobCount],
    ["workCorrectCount", workCorrectCount],
  ] as const) {
    if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) {
      return NextResponse.json({ error: `${name} は0以上の整数で入力してください` }, { status: 400 });
    }
  }

  // 提出時のみ必須3項目をチェック
  if (!draft) {
    if (typeof learned !== "string" || learned.trim().length === 0) {
      return NextResponse.json({ error: "「今日一番の学び」は必須です" }, { status: 400 });
    }
    if (typeof confused !== "string" || confused.trim().length === 0) {
      return NextResponse.json({ error: "「分からなかった言葉・概念」は必須です" }, { status: 400 });
    }
    if (typeof questions !== "string" || questions.trim().length === 0) {
      return NextResponse.json({ error: "「明日聞きたいこと」は必須です" }, { status: 400 });
    }
  }

  // 理解度回答の検証（rating はサーバー側でも A/B/C/D を検証）
  const answers: { itemId: string; rating: string }[] = [];
  if (checkAnswers !== undefined && checkAnswers !== null) {
    if (!Array.isArray(checkAnswers)) {
      return NextResponse.json({ error: "checkAnswers の形式が不正です" }, { status: 400 });
    }
    for (const a of checkAnswers) {
      if (
        !a ||
        typeof a !== "object" ||
        typeof a.itemId !== "string" ||
        a.itemId.length === 0 ||
        typeof a.rating !== "string" ||
        !VALID_RATINGS.includes(a.rating)
      ) {
        return NextResponse.json({ error: "理解度の回答が不正です" }, { status: 400 });
      }
      answers.push({ itemId: a.itemId, rating: a.rating });
    }
  }

  // itemLabel 非正規化のためマスタを引く（存在しない itemId は 400）
  const items =
    answers.length > 0
      ? await prisma.trainingCheckItem.findMany({
          where: { id: { in: answers.map((a) => a.itemId) } },
          select: { id: true, label: true },
        })
      : [];
  const labelMap = new Map(items.map((i) => [i.id, i.label]));
  for (const a of answers) {
    if (!labelMap.has(a.itemId)) {
      return NextResponse.json({ error: "存在しない理解度項目が含まれています" }, { status: 400 });
    }
  }

  const reportDate = todayJst();
  const commonData = {
    userName: actor.name ?? actor.email ?? "不明",
    learned: typeof learned === "string" ? learned.trim() : "",
    confused: typeof confused === "string" ? confused.trim() : "",
    questions: typeof questions === "string" ? questions.trim() : "",
    freeNote: optionalText(freeNote),
    dayLabel: optionalText(dayLabel),
    workJobCount: typeof workJobCount === "number" ? workJobCount : null,
    workCorrectCount: typeof workCorrectCount === "number" ? workCorrectCount : null,
    workTarget: optionalText(workTarget),
    workMistake: optionalText(workMistake),
    workNextTime: optionalText(workNextTime),
    observeScene: optionalText(observeScene),
    observeHard: optionalText(observeHard),
    isDraft: draft,
    ...(draft ? {} : { submittedAt: new Date() }),
  };

  const reflection = await prisma.$transaction(async (tx) => {
    const saved = await tx.trainingReflection.upsert({
      where: { userId_reportDate: { userId: actor.id, reportDate } },
      update: commonData,
      create: {
        userId: actor.id,
        reportDate,
        ...commonData,
      },
    });

    // 理解度回答は全削除 → 一括作成（差分更新にしない）
    await tx.trainingCheckAnswer.deleteMany({ where: { reflectionId: saved.id } });
    if (answers.length > 0) {
      await tx.trainingCheckAnswer.createMany({
        data: answers.map((a) => ({
          reflectionId: saved.id,
          itemId: a.itemId,
          itemLabel: labelMap.get(a.itemId)!,
          rating: a.rating,
        })),
      });
    }

    return saved;
  });

  return NextResponse.json({ id: reflection.id, reportDate: reflection.reportDate });
}

// 一覧: admin は全員分（userId で絞り込み可）、member は自分の分のみ
// 各振り返りに理解度回答（answers）を付けて返す
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const isAdmin = actor.role === "admin";

  const userIdParam = sp.get("userId");
  const userId = isAdmin ? userIdParam || undefined : actor.id;

  // reportDate は "YYYY-MM-DD" の文字列なので範囲は文字列比較でよい
  const from = sp.get("from");
  const to = sp.get("to");
  const reportDate: { gte?: string; lte?: string } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) reportDate.gte = from;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) reportDate.lte = to;

  const reflections = await prisma.trainingReflection.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(reportDate.gte || reportDate.lte ? { reportDate } : {}),
    },
    orderBy: [{ reportDate: "desc" }, { userName: "asc" }],
  });

  // FK を張っていないため理解度回答は reflectionId で合流させる
  const answerRows =
    reflections.length > 0
      ? await prisma.trainingCheckAnswer.findMany({
          where: { reflectionId: { in: reflections.map((r) => r.id) } },
          select: { reflectionId: true, itemId: true, itemLabel: true, rating: true },
        })
      : [];
  const answersByReflection = new Map<string, typeof answerRows>();
  for (const a of answerRows) {
    const list = answersByReflection.get(a.reflectionId) ?? [];
    list.push(a);
    answersByReflection.set(a.reflectionId, list);
  }

  const withAnswers = reflections.map((r) => ({
    ...r,
    answers: answersByReflection.get(r.id) ?? [],
  }));

  // selfId はフォームのプリフィル用（admin は全員分が返るため自分の当日分を特定する必要がある）
  return NextResponse.json({
    reflections: withAnswers,
    isAdmin,
    today: todayJst(),
    selfId: actor.id,
  });
}

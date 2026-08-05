import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const VALID_QUIZ_KEYS = ["lv1", "sales", "ca_ra", "yomikata"];
const MAX_LIMIT = 500;

// クイズ結果の記録: ログイン済み全員（静的HTML public/training/quiz/ から same-origin で呼ばれる）
// ユーザー情報はボディから受け取らず、必ずセッションから取得する
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
    quizKey,
    quizTitle,
    mode,
    round,
    startedAt,
    finishedAt,
    totalQuestions,
    correctCount,
    cleared,
    answers,
  } = body;

  if (typeof quizKey !== "string" || !VALID_QUIZ_KEYS.includes(quizKey)) {
    return NextResponse.json({ error: "quizKey が不正です" }, { status: 400 });
  }
  if (typeof quizTitle !== "string" || quizTitle.trim().length === 0) {
    return NextResponse.json({ error: "quizTitle は必須です" }, { status: 400 });
  }
  if (typeof mode !== "string" || mode.trim().length === 0) {
    return NextResponse.json({ error: "mode は必須です" }, { status: 400 });
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1) {
    return NextResponse.json({ error: "round が不正です" }, { status: 400 });
  }
  const startedAtDate = typeof startedAt === "string" ? new Date(startedAt) : null;
  const finishedAtDate = typeof finishedAt === "string" ? new Date(finishedAt) : null;
  if (!startedAtDate || Number.isNaN(startedAtDate.getTime())) {
    return NextResponse.json({ error: "startedAt が不正です" }, { status: 400 });
  }
  if (!finishedAtDate || Number.isNaN(finishedAtDate.getTime())) {
    return NextResponse.json({ error: "finishedAt が不正です" }, { status: 400 });
  }
  if (typeof totalQuestions !== "number" || !Number.isInteger(totalQuestions) || totalQuestions < 1) {
    return NextResponse.json({ error: "totalQuestions が不正です" }, { status: 400 });
  }
  if (
    typeof correctCount !== "number" ||
    !Number.isInteger(correctCount) ||
    correctCount < 0 ||
    correctCount > totalQuestions
  ) {
    return NextResponse.json({ error: "correctCount が不正です" }, { status: 400 });
  }
  if (typeof cleared !== "boolean") {
    return NextResponse.json({ error: "cleared が不正です" }, { status: 400 });
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return NextResponse.json({ error: "answers は1件以上必要です" }, { status: 400 });
  }
  for (const a of answers) {
    if (
      !a ||
      typeof a !== "object" ||
      typeof a.qid !== "string" ||
      a.qid.length === 0 ||
      typeof a.category !== "string" ||
      typeof a.questionText !== "string" ||
      a.questionText.length === 0 ||
      typeof a.chosenText !== "string" ||
      typeof a.correctText !== "string" ||
      typeof a.isCorrect !== "boolean" ||
      typeof a.position !== "number" ||
      !Number.isInteger(a.position)
    ) {
      return NextResponse.json({ error: "answers の要素が不正です" }, { status: 400 });
    }
  }

  const attempt = await prisma.$transaction(async (tx) => {
    const created = await tx.trainingQuizAttempt.create({
      data: {
        userId: actor.id,
        userName: actor.name ?? actor.email ?? "不明",
        quizKey,
        quizTitle: quizTitle.trim(),
        mode: mode.trim(),
        round,
        totalQuestions,
        correctCount,
        cleared,
        startedAt: startedAtDate,
        finishedAt: finishedAtDate,
      },
    });

    await tx.trainingQuizAnswer.createMany({
      data: answers.map((a: {
        qid: string;
        category: string;
        questionText: string;
        chosenText: string;
        correctText: string;
        isCorrect: boolean;
        position: number;
      }) => ({
        attemptId: created.id,
        qid: a.qid,
        category: a.category,
        questionText: a.questionText,
        chosenText: a.chosenText,
        correctText: a.correctText,
        isCorrect: a.isCorrect,
        position: a.position,
      })),
    });

    return created;
  });

  return NextResponse.json({ id: attempt.id });
}

// 履歴一覧: admin は全員分（userId で絞り込み可）、member は自分の分のみ
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const isAdmin = actor.role === "admin";

  // mine=1 は admin でも自分の分に絞る（教材カードの自分の実績表示用）
  const mine = sp.get("mine") === "1";
  const userIdParam = sp.get("userId");
  const userId = mine ? actor.id : isAdmin ? userIdParam || undefined : actor.id;

  const quizKey = sp.get("quizKey") || undefined;

  // 日付フィルタは JST 境界で判定する（罠#17: Railway 本番は UTC）
  const from = sp.get("from");
  const to = sp.get("to");
  const finishedAt: { gte?: Date; lte?: Date } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    finishedAt.gte = new Date(`${from}T00:00:00+09:00`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    finishedAt.lte = new Date(`${to}T23:59:59.999+09:00`);
  }

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get("limit") || "50", 10) || 50));

  const where = {
    ...(userId ? { userId } : {}),
    ...(quizKey ? { quizKey } : {}),
    ...(finishedAt.gte || finishedAt.lte ? { finishedAt } : {}),
  };

  const [total, attempts] = await Promise.all([
    prisma.trainingQuizAttempt.count({ where }),
    prisma.trainingQuizAttempt.findMany({
      where,
      orderBy: { finishedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        userName: true,
        quizKey: true,
        quizTitle: true,
        mode: true,
        round: true,
        totalQuestions: true,
        correctCount: true,
        cleared: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
  ]);

  return NextResponse.json({ attempts, total, page, limit, isAdmin });
}

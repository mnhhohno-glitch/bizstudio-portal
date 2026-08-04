import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 設問別の誤答率集計: admin 限定
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const quizKey = request.nextUrl.searchParams.get("quizKey") || undefined;
  const where = quizKey ? { attempt: { quizKey } } : {};

  // qid ごとの回答総数・誤答数を集計し、表示用に設問文（最新の1件）を紐付ける
  const [totals, wrongs, questionTexts] = await Promise.all([
    prisma.trainingQuizAnswer.groupBy({
      by: ["qid"],
      where,
      _count: { _all: true },
    }),
    prisma.trainingQuizAnswer.groupBy({
      by: ["qid"],
      where: { ...where, isCorrect: false },
      _count: { _all: true },
    }),
    prisma.trainingQuizAnswer.findMany({
      where,
      distinct: ["qid"],
      orderBy: { id: "desc" },
      select: { qid: true, category: true, questionText: true },
    }),
  ]);

  const wrongMap = new Map(wrongs.map((w) => [w.qid, w._count._all]));
  const textMap = new Map(questionTexts.map((t) => [t.qid, t]));

  const stats = totals
    .map((t) => {
      const total = t._count._all;
      const wrong = wrongMap.get(t.qid) ?? 0;
      const info = textMap.get(t.qid);
      return {
        qid: t.qid,
        category: info?.category ?? "",
        questionText: info?.questionText ?? "",
        total,
        wrong,
        wrongRate: total > 0 ? wrong / total : 0,
      };
    })
    .sort((a, b) => b.wrongRate - a.wrongRate || b.total - a.total);

  return NextResponse.json({ stats });
}

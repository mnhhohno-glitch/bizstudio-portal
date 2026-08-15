import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { jstDateStart, jstDateEnd } from "@/lib/dailyReport/jstDate";

// 設問別の誤答率集計: admin 限定
// quizKey / userId / date（JST の "YYYY-MM-DD"）で絞り込める
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const quizKey = sp.get("quizKey") || undefined;
  const userId = sp.get("userId") || undefined;
  const dateParam = sp.get("date");
  // 研修日は JST 基準。UTC 動作の本番で日付がずれないよう JST の1日を Date 範囲に変換する（罠#17）
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

  const attemptFilter = {
    ...(quizKey ? { quizKey } : {}),
    ...(userId ? { userId } : {}),
    ...(date ? { finishedAt: { gte: jstDateStart(date), lte: jstDateEnd(date) } } : {}),
  };
  const where =
    Object.keys(attemptFilter).length > 0 ? { attempt: attemptFilter } : {};

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

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdminClient, { type SummaryRow, type QuizOption } from "./AdminClient";

// 社員別サマリは server component で組み立てる（quizKey を持つ全教材 × 全アクティブユーザー、未受験も行に出す）
export default async function TrainingAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/training");

  const [quizMaterials, activeUsers, attempts] = await Promise.all([
    prisma.trainingMaterial.findMany({
      where: { quizKey: { not: null } },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      select: { quizKey: true, title: true },
    }),
    prisma.user.findMany({
      where: { status: "active" },
      orderBy: [{ employeeNumber: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.trainingQuizAttempt.findMany({
      select: {
        userId: true,
        quizKey: true,
        mode: true,
        round: true,
        totalQuestions: true,
        correctCount: true,
        cleared: true,
        finishedAt: true,
      },
    }),
  ]);

  const quizzes: QuizOption[] = quizMaterials
    .filter((m): m is { quizKey: string; title: string } => m.quizKey !== null)
    .map((m) => ({ quizKey: m.quizKey, title: m.title }));

  const rows: SummaryRow[] = [];
  for (const u of activeUsers) {
    for (const q of quizzes) {
      const own = attempts.filter((a) => a.userId === u.id && a.quizKey === q.quizKey);
      let bestLabel: string | null = null;
      let clearLabel: "未受験" | "未クリア" | string = own.length === 0 ? "未受験" : "未クリア";
      if (own.length > 0) {
        // スコアは全問チャレンジの1周目を優先（範囲別だと分母が変わるため）
        const full = own.filter((a) => a.mode === "全問チャレンジ");
        const source = full.length > 0 ? full : own;
        const round1 = source.filter((a) => a.round === 1);
        const pool = round1.length > 0 ? round1 : source;
        const best = pool.reduce((m, a) =>
          a.correctCount / a.totalQuestions > m.correctCount / m.totalQuestions ? a : m
        );
        bestLabel = `${best.correctCount}/${best.totalQuestions}`;
        const clearedOnes = source
          .filter((a) => a.cleared)
          .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
        if (clearedOnes.length > 0) {
          clearLabel = `✓ ${clearedOnes[0].round}周でクリア`;
        }
      }
      rows.push({
        userId: u.id,
        userName: u.name ?? u.email,
        quizKey: q.quizKey,
        quizTitle: q.title,
        attemptCount: own.length,
        bestLabel,
        clearLabel,
      });
    }
  }

  return <AdminClient summary={rows} quizzes={quizzes} />;
}

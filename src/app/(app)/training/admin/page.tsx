import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdminClient, { type AttemptRow, type EmployeeOption, type QuizOption } from "./AdminClient";

// 社員別サマリは「研修日で絞れる」必要があるため、集計済みの行ではなく受験履歴そのものを渡し、
// 絞り込みを反映した集計はクライアント側で行う
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
        userName: true,
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

  // 退職者など active でない受験者も、過去の記録が消えないよう一覧に含める
  const activeIds = new Set(activeUsers.map((u) => u.id));
  const employees: EmployeeOption[] = activeUsers.map((u) => ({
    id: u.id,
    name: u.name ?? u.email,
    isActive: true,
  }));
  const seenExtra = new Set<string>();
  for (const a of attempts) {
    if (!activeIds.has(a.userId) && !seenExtra.has(a.userId)) {
      seenExtra.add(a.userId);
      employees.push({ id: a.userId, name: a.userName, isActive: false });
    }
  }

  const attemptRows: AttemptRow[] = attempts.map((a) => ({
    userId: a.userId,
    quizKey: a.quizKey,
    mode: a.mode,
    round: a.round,
    totalQuestions: a.totalQuestions,
    correctCount: a.correctCount,
    cleared: a.cleared,
    finishedAt: a.finishedAt.toISOString(),
  }));

  return <AdminClient quizzes={quizzes} employees={employees} attempts={attemptRows} />;
}

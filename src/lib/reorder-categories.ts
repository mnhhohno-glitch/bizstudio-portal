import { prisma } from "./prisma";

/**
 * 全カテゴリのsortOrderを1から連番に振り直す
 */
export async function reorderCategories(): Promise<void> {
  const categories = await prisma.taskCategory.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  await Promise.all(
    categories.map((cat, i) =>
      prisma.taskCategory.update({
        where: { id: cat.id },
        data: { sortOrder: i + 1 },
      })
    )
  );
}

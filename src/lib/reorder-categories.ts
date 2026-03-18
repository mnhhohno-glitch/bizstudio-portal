import { prisma } from "./prisma";

/**
 * 指定グループ内のカテゴリのsortOrderを1から連番に振り直す
 * groupId が null の場合は未分類カテゴリを振り直す
 */
export async function reorderCategoriesInGroup(groupId: string | null): Promise<void> {
  const categories = await prisma.taskCategory.findMany({
    where: { groupId },
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

/**
 * 全グループのカテゴリのsortOrderをグループ内で1から連番に振り直す
 */
export async function reorderAllCategories(): Promise<void> {
  const groups = await prisma.taskCategoryGroup.findMany({
    select: { id: true },
  });

  // 各グループ内を振り直す
  for (const group of groups) {
    await reorderCategoriesInGroup(group.id);
  }

  // 未分類も振り直す
  await reorderCategoriesInGroup(null);
}

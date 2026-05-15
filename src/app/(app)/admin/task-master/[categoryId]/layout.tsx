import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type Props = {
  params: Promise<{ categoryId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { categoryId } = await params;
  const user = await getSessionUser();
  if (!user) return {};

  const category = await prisma.taskCategory.findUnique({
    where: { id: categoryId },
    select: { name: true },
  });
  if (!category) return {};

  return { title: category.name };
}

export default function Layout({ children }: Props) {
  return children;
}

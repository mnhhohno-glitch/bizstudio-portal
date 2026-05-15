import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type Props = {
  params: Promise<{ taskId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { taskId } = await params;
  const user = await getSessionUser();
  if (!user) return {};

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true },
  });
  if (!task) return {};

  return { title: `${task.title} 編集` };
}

export default function Layout({ children }: Props) {
  return children;
}

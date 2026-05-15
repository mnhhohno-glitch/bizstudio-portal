import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return {};

  const announcement = await prisma.announcement.findUnique({
    where: { id },
    select: { title: true },
  });
  if (!announcement) return {};

  return { title: announcement.title };
}

export default function Layout({ children }: Props) {
  return children;
}

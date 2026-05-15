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

  const document = await prisma.document.findUnique({
    where: { id },
    select: { title: true },
  });
  if (!document) return {};

  return { title: document.title };
}

export default function Layout({ children }: Props) {
  return children;
}

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { AppState } from "@/types/jimu";
import { initialAppState } from "@/types/jimu";
import JimuWizard from "@/components/jimu/JimuWizard";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function JimuPage({ params }: PageProps) {
  const { token } = await params;

  const session = await prisma.jimuSession.findUnique({
    where: { token },
  });

  if (!session) {
    notFound();
  }

  const state = (session.state as unknown as AppState) || initialAppState;

  return <JimuWizard token={token} initialState={state} />;
}

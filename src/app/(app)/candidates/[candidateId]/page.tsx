import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import CandidateDetailPage from "@/components/candidates/CandidateDetailPage";

type Props = {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { candidateId } = await params;
  const { view } = await searchParams;

  const user = await getSessionUser();
  if (!user) return {};

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { name: true },
  });
  if (!candidate) return {};

  return {
    title: view === "interview"
      ? `面談履歴_${candidate.name}`
      : candidate.name,
  };
}

export default function Page() {
  return <CandidateDetailPage />;
}

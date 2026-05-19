import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import CandidateDetailPage from "@/components/candidates/CandidateDetailPage";

type Props = {
  params: Promise<{ candidateId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { candidateId } = await params;

  const user = await getSessionUser();
  if (!user) return {};

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { name: true },
  });
  if (!candidate) return {};

  return {
    title: candidate.name,
  };
}

export default function Page() {
  return <CandidateDetailPage />;
}

import type { Metadata } from "next";

type Props = {
  params: Promise<{ date: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { date } = await params;
  return { title: `勤怠修正 ${date}` };
}

export default function Layout({ children }: Props) {
  return children;
}

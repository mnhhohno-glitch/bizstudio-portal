import type { Metadata } from "next";

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { id } = await params;
  return { title: `RPAエラー詳細 #${id.slice(0, 8)}` };
}

export default function Layout({ children }: Props) {
  return children;
}

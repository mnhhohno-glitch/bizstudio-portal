import type { Metadata } from "next";

type Props = {
  params: Promise<{ batchId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({
  params,
}: Omit<Props, "children">): Promise<Metadata> {
  const { batchId } = await params;
  return { title: `RPA実行履歴 #${batchId.slice(0, 8)}` };
}

export default function Layout({ children }: Props) {
  return children;
}

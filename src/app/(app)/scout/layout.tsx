import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "スカウト運用",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

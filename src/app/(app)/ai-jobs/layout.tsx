import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI求人一覧",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

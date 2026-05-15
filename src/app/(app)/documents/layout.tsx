import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "書類一覧",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

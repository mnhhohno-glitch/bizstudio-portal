import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "エントリー一覧",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

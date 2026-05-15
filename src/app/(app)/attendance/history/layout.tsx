import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "勤怠履歴",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

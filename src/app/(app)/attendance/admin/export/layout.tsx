import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "勤怠エクスポート",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

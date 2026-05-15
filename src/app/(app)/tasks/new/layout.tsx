import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "タスク新規作成",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "お知らせ管理",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

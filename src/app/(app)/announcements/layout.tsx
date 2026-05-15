import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "お知らせ一覧",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

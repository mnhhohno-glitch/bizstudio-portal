import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "システム管理",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

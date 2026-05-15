import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "認証中",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

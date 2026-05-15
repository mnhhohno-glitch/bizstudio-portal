import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "既知エラー",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

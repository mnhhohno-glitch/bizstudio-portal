import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "マニュアル一覧",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

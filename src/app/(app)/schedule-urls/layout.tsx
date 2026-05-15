import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "日程調整URL",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

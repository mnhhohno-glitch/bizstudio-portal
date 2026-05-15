import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "勤怠記録",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

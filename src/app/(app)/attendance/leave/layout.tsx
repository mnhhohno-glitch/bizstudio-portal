import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "休暇申請",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "社内研修",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

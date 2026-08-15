import type { Metadata } from "next";
import RpaScoutTabs from "./RpaScoutTabs";

export const metadata: Metadata = { title: "RPAスカウト管理" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <RpaScoutTabs />
      {children}
    </div>
  );
}

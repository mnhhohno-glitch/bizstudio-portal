import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { ScoutRoleProvider } from "@/components/scout/ScoutRoleContext";

export const metadata: Metadata = {
  title: "スカウト運用",
};

// T-135 T-C: サーバー側で role を判定し、配下クライアント（ScoutNav 等）へ isAdmin を配る。
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";
  return <ScoutRoleProvider isAdmin={isAdmin}>{children}</ScoutRoleProvider>;
}

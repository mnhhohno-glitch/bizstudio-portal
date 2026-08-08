import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import TrainingTabs from "./TrainingTabs";

export const metadata: Metadata = {
  title: "社内研修",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";

  return (
    <div>
      <TrainingTabs isAdmin={!!isAdmin} />
      {children}
    </div>
  );
}

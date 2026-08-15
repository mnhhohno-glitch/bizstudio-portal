import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import DashboardClient from "../_components/DashboardClient";

export default async function RpaScoutDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <DashboardClient />;
}

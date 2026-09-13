import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ConditionsClient from "./_components/ConditionsClient";

// T-194: スカウト配信条件コンソール（/scout/conditions）
export default async function ScoutConditionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <ConditionsClient />;
}

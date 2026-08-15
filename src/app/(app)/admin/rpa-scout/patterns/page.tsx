import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import PatternsClient from "../_components/PatternsClient";

export default async function RpaScoutPatternsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <PatternsClient />;
}

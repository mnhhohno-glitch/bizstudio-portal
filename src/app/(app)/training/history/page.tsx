import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import HistoryClient from "./HistoryClient";

export default async function TrainingHistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <HistoryClient isAdmin={user.role === "admin"} />;
}

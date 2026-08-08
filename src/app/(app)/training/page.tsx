import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TrainingPageClient from "./TrainingPageClient";

export default async function TrainingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <TrainingPageClient isAdmin={user.role === "admin"} />;
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ReflectionClient from "./ReflectionClient";

export default async function TrainingReflectionPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <ReflectionClient isAdmin={user.role === "admin"} />;
}

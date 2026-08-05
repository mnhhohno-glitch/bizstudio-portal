import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import WorkClient from "./WorkClient";

export default async function TrainingWorkPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <WorkClient />;
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TemplatesClient from "../_components/TemplatesClient";

export default async function RpaScoutTemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <TemplatesClient />;
}

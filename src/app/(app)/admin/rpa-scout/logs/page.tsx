import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LogsClient from "../_components/LogsClient";

export default async function RpaScoutLogsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <LogsClient />;
}

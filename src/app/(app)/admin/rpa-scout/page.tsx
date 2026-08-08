import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import StatusBoardClient from "./_components/StatusBoardClient";

export default async function RpaScoutPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <StatusBoardClient />;
}

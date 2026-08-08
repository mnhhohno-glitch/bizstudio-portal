import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import CalendarClient from "../_components/CalendarClient";

export default async function RpaScoutCalendarPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <CalendarClient />;
}

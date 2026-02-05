import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/layout/TopBar";
import Sidebar from "@/components/layout/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <TopBar companyName="Bizstudio Portal" isAdmin={isAdmin} />
      <div className="flex">
        <Sidebar isAdmin={isAdmin} />
        <main className="min-h-[calc(100vh-56px)] flex-1 bg-white p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/layout/TopBar";
import Sidebar from "@/components/layout/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const isAdmin = user.role === "admin";
  const userName = user.name ?? user.email;

  return (
    <div className="min-h-screen bg-white">
      <div className="flex min-h-screen">
        <Sidebar isAdmin={isAdmin} />

        <div className="flex min-h-screen flex-1 flex-col">
          <TopBar companyName="Bizstudio Portal" userName={userName} />

          <main className="flex-1 bg-[#F5F7FA] p-6">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

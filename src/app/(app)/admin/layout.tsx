import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="rounded-lg border bg-white p-6">
        <h1 className="text-xl font-semibold">403 Forbidden</h1>
        <p className="mt-2 text-slate-600 text-sm">
          このページにアクセスする権限がありません。
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

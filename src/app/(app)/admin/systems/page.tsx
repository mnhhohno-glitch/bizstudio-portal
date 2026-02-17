import { prisma } from "@/lib/prisma";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import SystemForm from "./SystemForm";

export default async function AdminSystemsPage() {
  const systems = await prisma.systemLink.findMany({
    orderBy: { sortOrder: "asc" },
  });

  const activeCount = systems.filter((s) => s.status === "active").length;

  return (
    <div>
      <PageTitle>システム管理</PageTitle>
      <PageSubtleText>
        有効なシステム数: <span className="font-semibold">{activeCount}</span>
      </PageSubtleText>

      <div className="mt-6">
        <SystemForm systems={systems} />
      </div>
    </div>
  );
}

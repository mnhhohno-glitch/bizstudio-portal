import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import InterviewListClient from "./InterviewListClient";

export const metadata: Metadata = { title: "面談管理" };

export default async function InterviewManagementPage() {
  const actor = await getSessionUser();

  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    orderBy: { employeeNumber: "asc" },
    select: { id: true, employeeNumber: true, name: true },
  });

  const currentEmployee = actor
    ? employees.find((e) => e.name === actor.name)
    : null;

  return (
    <div>
      <InterviewListClient
        employees={employees}
        currentEmployeeId={currentEmployee?.id ?? null}
      />
    </div>
  );
}

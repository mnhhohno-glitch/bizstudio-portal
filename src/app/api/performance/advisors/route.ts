// T-071: 実績表の担当セレクト用。jobCategory='CA' の active な Employee 一覧を返す。
// あわせてログインユーザー本人の employeeId（初期選択用）を返す。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [advisors, self] = await Promise.all([
    prisma.employee.findMany({
      where: { jobCategory: "CA", status: "active" },
      select: { id: true, name: true },
      orderBy: { employeeNumber: "asc" },
    }),
    prisma.employee.findFirst({
      where: { name: user.name, status: "active" },
      select: { id: true },
    }),
  ]);

  return NextResponse.json({
    advisors,
    selfEmployeeId: self?.id ?? null,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const { id } = await params;
  const { name, email, employeeNumber, role, lineworksId } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (email !== undefined) data.email = email.trim();
  if (employeeNumber !== undefined) data.employeeNumber = employeeNumber === "" || employeeNumber === null ? null : Number(employeeNumber);
  if (role !== undefined && (role === "admin" || role === "member")) data.role = role;
  if (lineworksId !== undefined) data.lineworksId = lineworksId?.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, employeeNumber: true, role: true, lineworksId: true },
    });
    return NextResponse.json({ ok: true, user: updated });
  } catch {
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

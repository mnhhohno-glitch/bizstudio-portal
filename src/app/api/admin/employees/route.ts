import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// T-096: Employee 新規作成＋User リンク（admin 限定）。
// /admin/users/[id] で Employee 未登録ユーザーに社員番号を与えて作成する用途。
export async function POST(req: Request) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const employeeNumber =
    typeof body.employeeNumber === "string" || typeof body.employeeNumber === "number"
      ? String(body.employeeNumber).trim()
      : "";
  if (!userId || !employeeNumber) {
    return NextResponse.json({ error: "userId と employeeNumber は必須です" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "対象のユーザーが見つかりません" }, { status: 404 });
  }

  const alreadyLinked = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (alreadyLinked) {
    return NextResponse.json({ error: "このユーザーには既に Employee が紐づいています" }, { status: 400 });
  }

  const numberTaken = await prisma.employee.findUnique({
    where: { employeeNumber },
    select: { id: true, name: true, userId: true },
  });
  if (numberTaken) {
    if (numberTaken.userId === null) {
      // 同番号の未リンク Employee が居る場合はリンクして再利用（重複作成を防ぐ）
      const linked = await prisma.employee.update({
        where: { id: numberTaken.id },
        data: { userId },
        select: { id: true, employeeNumber: true, name: true, userId: true },
      });
      return NextResponse.json({ ok: true, employee: linked, linkedExisting: true });
    }
    return NextResponse.json({ error: "この社員番号は既に別の社員に使われています" }, { status: 400 });
  }

  const employee = await prisma.employee.create({
    data: { employeeNumber, name: user.name, userId },
    select: { id: true, employeeNumber: true, name: true, userId: true },
  });

  return NextResponse.json({ ok: true, employee }, { status: 201 });
}

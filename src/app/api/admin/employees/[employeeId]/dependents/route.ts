import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { buildDependentData } from "@/lib/employee-detail";

// T-096: 扶養家族（EmployeeDependent 1:N）の追加・編集・削除（admin 限定）。

async function guard() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { employeeId } = await params;
  const exists = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "社員が見つかりません" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data = buildDependentData(body ?? {});

  const maxSort = await prisma.employeeDependent.aggregate({
    where: { employeeId },
    _max: { sortOrder: true },
  });
  if (data.sortOrder === undefined || data.sortOrder === null) {
    data.sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
  }

  const dependent = await prisma.employeeDependent.create({
    data: { employeeId, ...(data as object) },
  });
  return NextResponse.json({ ok: true, dependent }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { employeeId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }

  const dependent = await prisma.employeeDependent.findUnique({
    where: { id: body.id },
    select: { id: true, employeeId: true },
  });
  if (!dependent || dependent.employeeId !== employeeId) {
    return NextResponse.json({ error: "対象の扶養家族が見つかりません" }, { status: 404 });
  }

  const data = buildDependentData(body);
  await prisma.employeeDependent.update({ where: { id: body.id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const denied = await guard();
  if (denied) return denied;

  const { employeeId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }

  const dependent = await prisma.employeeDependent.findUnique({
    where: { id: body.id },
    select: { id: true, employeeId: true },
  });
  if (!dependent || dependent.employeeId !== employeeId) {
    return NextResponse.json({ error: "対象の扶養家族が見つかりません" }, { status: 404 });
  }

  await prisma.employeeDependent.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}

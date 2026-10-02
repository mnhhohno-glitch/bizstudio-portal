import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  listInactivePeriods,
  parseInactivePeriodInput,
  saveInactivePeriod,
  InactivePeriodOverlapError,
} from "@/lib/employee-inactive-periods";

// T-XXX step6: 稼働しない期間（EmployeeInactivePeriod 1:N）の一覧・追加・編集・削除（admin 限定・社員詳細と同じ権限）。
// 受け取る・返すのは期間（startDate / endDate）だけ。理由は受け取らない（body に入っていても読まない）。

async function guard() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return { denied: NextResponse.json({ error: "forbidden" }, { status: 403 }), actor: null };
  }
  return { denied: null, actor };
}

async function employeeExists(employeeId: string): Promise<boolean> {
  return !!(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { denied } = await guard();
  if (denied) return denied;
  const { employeeId } = await params;
  if (!(await employeeExists(employeeId))) {
    return NextResponse.json({ error: "社員が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ periods: await listInactivePeriods(employeeId) });
}

async function save(req: Request, employeeId: string, actorUserId: string, mode: "create" | "update") {
  if (!(await employeeExists(employeeId))) {
    return NextResponse.json({ error: "社員が見つかりません" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const id = mode === "update" ? (body && typeof body.id === "string" ? body.id : null) : undefined;
  if (mode === "update" && !id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  const parsed = parseInactivePeriodInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const period = await saveInactivePeriod({ employeeId, id: id ?? undefined, period: parsed.value, actorUserId });
    if (!period) return NextResponse.json({ error: "対象の期間が見つかりません" }, { status: 404 });
    return NextResponse.json({ ok: true, period }, { status: mode === "create" ? 201 : 200 });
  } catch (e) {
    if (e instanceof InactivePeriodOverlapError) {
      return NextResponse.json({ error: e.message, conflict: e.conflict }, { status: 409 });
    }
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { denied, actor } = await guard();
  if (denied) return denied;
  const { employeeId } = await params;
  return save(req, employeeId, actor!.id, "create");
}

export async function PATCH(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { denied, actor } = await guard();
  if (denied) return denied;
  const { employeeId } = await params;
  return save(req, employeeId, actor!.id, "update");
}

export async function DELETE(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { denied } = await guard();
  if (denied) return denied;
  const { employeeId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  }
  const row = await prisma.employeeInactivePeriod.findUnique({ where: { id: body.id }, select: { employeeId: true } });
  if (!row || row.employeeId !== employeeId) {
    return NextResponse.json({ error: "対象の期間が見つかりません" }, { status: 404 });
  }
  await prisma.employeeInactivePeriod.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const JOB_CATEGORY_VALUES = ["CA", "MARKETING", "OFFICE_AND_MGMT"] as const;
type JobCategoryInput = (typeof JOB_CATEGORY_VALUES)[number] | null;

function parseJobCategory(raw: unknown): JobCategoryInput | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw === "string" && (JOB_CATEGORY_VALUES as readonly string[]).includes(raw)) {
    return raw as JobCategoryInput;
  }
  return undefined;
}

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
  const { name, email, employeeNumber, role, lineworksId, jobCategory } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (email !== undefined) data.email = email.trim();
  if (employeeNumber !== undefined) data.employeeNumber = employeeNumber === "" || employeeNumber === null ? null : Number(employeeNumber);
  if (role !== undefined && (role === "admin" || role === "member")) data.role = role;
  if (lineworksId !== undefined) data.lineworksId = lineworksId?.trim() || null;

  const jobCategoryValue = parseJobCategory(jobCategory);

  if (Object.keys(data).length === 0 && jobCategoryValue === undefined) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }

  try {
    if (jobCategoryValue !== undefined) {
      const employee = await prisma.employee.findUnique({ where: { userId: id }, select: { id: true } });
      if (!employee) {
        return NextResponse.json(
          { error: "この社員には Employee レコードが紐づいていないため職種を設定できません" },
          { status: 400 }
        );
      }
      await prisma.employee.update({
        where: { id: employee.id },
        data: { jobCategory: jobCategoryValue },
      });
    }

    const updated = Object.keys(data).length > 0
      ? await prisma.user.update({
          where: { id },
          data,
          select: { id: true, name: true, email: true, employeeNumber: true, role: true, lineworksId: true },
        })
      : await prisma.user.findUnique({
          where: { id },
          select: { id: true, name: true, email: true, employeeNumber: true, role: true, lineworksId: true },
        });

    return NextResponse.json({ ok: true, user: updated });
  } catch {
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

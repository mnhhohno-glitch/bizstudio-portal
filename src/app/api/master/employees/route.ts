import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { formatName, validateName } from "@/lib/formatName";
import { z } from "zod";

// GET: 社員一覧取得（T-191: session 必須）
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const employees = await prisma.employee.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(employees);
  } catch (error) {
    console.error("Failed to fetch employees:", error);
    return NextResponse.json(
      { error: "社員一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}

// POST: 社員登録
const createSchema = z.object({
  employeeNumber: z.string().min(1, "社員番号を入力してください"),
  name: z.string().min(1, "氏名を入力してください"),
});

// T-191: 社員登録は admin 限定（/api/admin/employees と同じ判定）
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { employeeNumber, name } = parsed.data;

    // 氏名バリデーション
    const nameValidation = validateName(name);
    if (!nameValidation.valid) {
      return NextResponse.json(
        { error: nameValidation.error },
        { status: 400 }
      );
    }

    // 社員番号重複チェック
    const existing = await prisma.employee.findUnique({
      where: { employeeNumber },
    });
    if (existing) {
      return NextResponse.json(
        { error: "この社員番号は既に登録されています" },
        { status: 400 }
      );
    }

    // 氏名を整形して登録
    const formattedName = formatName(name);
    const employee = await prisma.employee.create({
      data: {
        employeeNumber,
        name: formattedName,
      },
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error("Failed to create employee:", error);
    return NextResponse.json(
      { error: "社員の登録に失敗しました" },
      { status: 500 }
    );
  }
}

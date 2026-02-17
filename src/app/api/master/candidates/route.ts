import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatName, validateName } from "@/lib/formatName";
import { z } from "zod";

// GET: 求職者一覧取得
export async function GET() {
  try {
    const candidates = await prisma.candidate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(candidates);
  } catch (error) {
    console.error("Failed to fetch candidates:", error);
    return NextResponse.json(
      { error: "求職者一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}

// POST: 求職者登録
const createSchema = z.object({
  candidateNumber: z.string().min(1, "求職者番号を入力してください"),
  name: z.string().min(1, "氏名を入力してください"),
  nameKana: z.string().min(1, "ふりがなを入力してください"),
  gender: z.enum(["male", "female", "other"], {
    message: "性別を選択してください",
  }),
  employeeId: z.string().min(1, "担当キャリアアドバイザーを選択してください"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { candidateNumber, name, nameKana, gender, employeeId } = parsed.data;

    // 氏名バリデーション
    const nameValidation = validateName(name);
    if (!nameValidation.valid) {
      return NextResponse.json(
        { error: nameValidation.error },
        { status: 400 }
      );
    }

    // 求職者番号重複チェック
    const existing = await prisma.candidate.findUnique({
      where: { candidateNumber },
    });
    if (existing) {
      return NextResponse.json(
        { error: "この求職者番号は既に登録されています" },
        { status: 400 }
      );
    }

    // 担当キャリアアドバイザーの存在確認
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      return NextResponse.json(
        { error: "指定された担当キャリアアドバイザーが見つかりません" },
        { status: 400 }
      );
    }

    // 氏名を整形して登録
    const formattedName = formatName(name);
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: formattedName,
        nameKana: nameKana.trim(),
        gender,
        employeeId,
      },
    });

    return NextResponse.json(candidate, { status: 201 });
  } catch (error) {
    console.error("Failed to create candidate:", error);
    return NextResponse.json(
      { error: "求職者の登録に失敗しました" },
      { status: 500 }
    );
  }
}

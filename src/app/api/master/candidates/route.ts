import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatName, validateName } from "@/lib/formatName";
import { getSessionUser } from "@/lib/auth";
import { z } from "zod";

// GET: 求職者一覧取得
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const includeEmployee = searchParams.get("include") === "employee";

    const candidates = await prisma.candidate.findMany({
      orderBy: { candidateNumber: "desc" },
      ...(includeEmployee && {
        include: { employee: { select: { id: true, name: true } } },
      }),
    });
    const total = candidates.length;

    // Job status determination (entry only)
    const candidateIds = candidates.map((c) => c.id);
    const entryCounts = await prisma.jobEntry.groupBy({
      by: ["candidateId"],
      where: { candidateId: { in: candidateIds } },
      _count: { id: true },
    });
    const entryCountMap = new Map(
      entryCounts.map((e) => [e.candidateId, e._count.id])
    );

    const candidatesWithStatus = candidates.map((c) => ({
      ...c,
      jobStatus: entryCountMap.has(c.id) ? "entry" : null,
    }));

    return NextResponse.json({ candidates: candidatesWithStatus, total });
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
  nameKana: z.string().min(1, "フリガナを入力してください"),
  email: z.string().email("正しいメールアドレスを入力してください").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  gender: z.enum(["male", "female", "other"], {
    message: "性別を選択してください",
  }),
  birthday: z.string().optional(),
  employeeId: z.string().min(1, "担当キャリアアドバイザーを選択してください"),
  desiredJobType1: z.string().optional(),
  desiredJobType2: z.string().optional(),
  desiredIndustry1: z.string().optional(),
  desiredPrefecture: z.string().optional(),
  desiredEmploymentType: z.string().optional(),
  desiredSalaryMin: z.number().int().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
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

    const {
      candidateNumber, name, nameKana, email, phone, address, gender, birthday, employeeId,
      desiredJobType1, desiredJobType2, desiredIndustry1, desiredPrefecture, desiredEmploymentType, desiredSalaryMin,
    } = parsed.data;

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
        ...(email ? { email: email.trim() } : {}),
        ...(phone ? { phone: phone.trim() } : {}),
        ...(address ? { address: address.trim() } : {}),
        gender,
        ...(birthday ? { birthday: new Date(birthday + "T12:00:00.000Z") } : {}),
        employeeId,
        desiredJobType1: desiredJobType1 || null,
        desiredJobType2: desiredJobType2 || null,
        desiredIndustry1: desiredIndustry1 || null,
        desiredPrefecture: desiredPrefecture || null,
        desiredEmploymentType: desiredEmploymentType || null,
        desiredSalaryMin: desiredSalaryMin ?? null,
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

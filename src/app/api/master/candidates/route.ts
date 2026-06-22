import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatName, validateName } from "@/lib/formatName";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { autoLinkCandidateToSlot } from "@/lib/scout/auto-link";

// GET: 求職者一覧取得
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const includeEmployee = searchParams.get("include") === "employee";
    const search = searchParams.get("search")?.trim() || "";
    const limitParam = parseInt(searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 500)
      : undefined;

    const where: Prisma.CandidateWhereInput = search
      ? {
          OR: [
            { name: { contains: search } },
            { nameKana: { contains: search } },
            { candidateNumber: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

    const candidates = await prisma.candidate.findMany({
      where,
      orderBy: { candidateNumber: "desc" },
      ...(limit ? { take: limit } : {}),
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
  recruiterName: z.string().optional().or(z.literal("")),
  applicationRoute: z.string().optional().or(z.literal("")),
  mediaSource: z.string().optional().or(z.literal("")),
  scoutNumber: z.string().optional().nullable(),
  scoutDeliveryDate: z.string().optional().nullable(),
  applicationDate: z.string().optional().nullable(),
  masType: z.string().optional().nullable(),
  desiredJobType1: z.string().optional().nullable(),
  desiredJobType2: z.string().optional().nullable(),
  desiredIndustry1: z.string().optional().nullable(),
  desiredIndustry2: z.string().optional().nullable(),
  desiredPrefecture1: z.string().optional().nullable(),
  desiredPrefecture2: z.string().optional().nullable(),
  desiredEmploymentType: z.string().optional().nullable(),
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
      candidateNumber,
      name,
      nameKana,
      email,
      phone,
      address,
      gender,
      birthday,
      employeeId,
      recruiterName,
      applicationRoute,
      mediaSource,
      scoutNumber,
      scoutDeliveryDate,
      applicationDate,
      masType,
      desiredJobType1,
      desiredJobType2,
      desiredIndustry1,
      desiredIndustry2,
      desiredPrefecture1,
      desiredPrefecture2,
      desiredEmploymentType,
      desiredSalaryMin,
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
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        ...(applicationRoute?.trim() ? { applicationRoute: applicationRoute.trim() } : {}),
        ...(mediaSource?.trim() ? { mediaSource: mediaSource.trim() } : {}),
        ...(scoutNumber?.trim() ? { scoutNumber: scoutNumber.trim() } : {}),
        // 配信日・応募日は JST暦日として正午UTCで保存（罠#17: TZ巻き戻り回避）
        ...(scoutDeliveryDate?.trim() ? { scoutDeliveryDate: new Date(scoutDeliveryDate.trim() + "T12:00:00.000Z") } : {}),
        ...(applicationDate?.trim() ? { applicationDate: new Date(applicationDate.trim() + "T12:00:00.000Z") } : {}),
        ...(masType?.trim() ? { masType: masType.trim() } : {}),
        ...(desiredJobType1?.trim() ? { desiredJobType1: desiredJobType1.trim() } : {}),
        ...(desiredJobType2?.trim() ? { desiredJobType2: desiredJobType2.trim() } : {}),
        ...(desiredIndustry1?.trim() ? { desiredIndustry1: desiredIndustry1.trim() } : {}),
        ...(desiredIndustry2?.trim() ? { desiredIndustry2: desiredIndustry2.trim() } : {}),
        ...(desiredPrefecture1?.trim() ? { desiredPrefecture1: desiredPrefecture1.trim() } : {}),
        ...(desiredPrefecture2?.trim() ? { desiredPrefecture2: desiredPrefecture2.trim() } : {}),
        ...(desiredEmploymentType?.trim() ? { desiredEmploymentType: desiredEmploymentType.trim() } : {}),
        ...(typeof desiredSalaryMin === "number" ? { desiredSalaryMin } : {}),
        employeeId,
      },
    });

    // T-065: 手動登録でもスカウト配信枠へ自動紐付け（PDF経路と同じ共通関数を使用）
    // ガード: 経路=スカウト かつ recruiterName あり のみ（紹介等を誤紐付けしない）
    // 日付: applicationDate ?? createdAt（PDF経路と統一）。失敗しても登録は成功させる。
    if (candidate.applicationRoute === "スカウト" && recruiterName?.trim()) {
      try {
        await autoLinkCandidateToSlot({
          candidateId: candidate.id,
          recruiterName: recruiterName.trim(),
          applicationDate: candidate.applicationDate ?? candidate.createdAt,
        });
      } catch (e) {
        console.error("[master/candidates] autoLinkCandidateToSlot failed:", e);
      }
    }

    return NextResponse.json(candidate, { status: 201 });
  } catch (error) {
    console.error("Failed to create candidate:", error);
    return NextResponse.json(
      { error: "求職者の登録に失敗しました" },
      { status: 500 }
    );
  }
}

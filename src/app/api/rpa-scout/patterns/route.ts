import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { generatePatternName } from "@/lib/rpa-scout/pattern-name";
import { pickConditionFields } from "@/lib/rpa-scout/pattern-fields";

type LastUsedRow = {
  key: string;
  recordedAt: Date;
  machineNo: number;
};

export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const includeInactive = sp.get("all") === "1";

  // 最終使用（全号機横断）は DISTINCT ON で一括取得する。
  // パターン件数に関係なく固定3クエリ（patterns / patternId別 / patternName別）で N+1 にしない。
  const [patterns, byIdRows, byNameRows] = await Promise.all([
    prisma.rpaScoutPattern.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ targetMachineNo: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
    prisma.$queryRaw<LastUsedRow[]>`
      SELECT DISTINCT ON ("patternId") "patternId" AS key, "recordedAt", "machineNo"
      FROM rpa_scout_logs
      WHERE "patternId" IS NOT NULL
      ORDER BY "patternId", "recordedAt" DESC`,
    // 移行ログ（patternId=null の1,192件）を拾うためのフォールバック照合キー
    prisma.$queryRaw<LastUsedRow[]>`
      SELECT DISTINCT ON ("patternName") "patternName" AS key, "recordedAt", "machineNo"
      FROM rpa_scout_logs
      ORDER BY "patternName", "recordedAt" DESC`,
  ]);

  const byId = new Map(byIdRows.map((r) => [r.key, r]));
  const byName = new Map(byNameRows.map((r) => [r.key, r]));

  return NextResponse.json({
    patterns: patterns.map((p) => {
      // patternId 紐付けを優先し、無ければパターン名の完全一致でフォールバック
      const last = byId.get(p.id) ?? byName.get(p.name) ?? null;
      return {
        ...p,
        lastUsedAt: last?.recordedAt ?? null,
        lastUsedMachineNo: last?.machineNo ?? null,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const targetMachineNo =
    typeof body.targetMachineNo === "number" &&
    body.targetMachineNo >= 1 &&
    body.targetMachineNo <= 6
      ? body.targetMachineNo
      : null;

  const fields = pickConditionFields(body);
  if ((fields.jobCategories?.length ?? 0) > 3)
    return NextResponse.json({ error: "希望職種は最大3件までです" }, { status: 400 });

  // 保存時もプレビューと同一の生成関数を使う
  const name = generatePatternName(fields);
  if (!name)
    return NextResponse.json({ error: "条件が未選択のため名前を生成できません" }, { status: 400 });

  const duplicate = await prisma.rpaScoutPattern.findFirst({
    where: { name, isActive: true },
    select: { id: true },
  });

  const pattern = await prisma.rpaScoutPattern.create({
    data: {
      targetMachineNo,
      name,
      ...fields,
      prefectures: fields.prefectures ?? undefined,
      jobCategories: fields.jobCategories ?? undefined,
      workLocations: fields.workLocations ?? undefined,
      isMigrated: false,
      createdByUserId: actor.id,
    },
  });

  return NextResponse.json({ pattern, duplicateWarning: !!duplicate });
}

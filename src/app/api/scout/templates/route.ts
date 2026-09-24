// T-207: 配信テンプレート管理 API（一覧 / 作成）
// 認証はログインセッション（getSessionUser）。RPA 向けには /api/external/scout-conditions/current が
// 「その条件で使うテンプレート」を返すため、この口は画面専用。
// テンプレート番号（T-001）はサーバー側で採番する。body の seqNo は受け取らない。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  createScoutTemplate,
  ensureTemplateSeqNos,
  parseTemplateInput,
  templateOrderBy,
  toTemplateDto,
} from "@/lib/scout-conditions/templates";
import type { TemplatesResponse } from "@/lib/scout-conditions/types";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // デプロイ中の窓で旧コードが作った seq_no 空の行があれば番号を振る（通常は0件）
  await ensureTemplateSeqNos();

  const [templates, usage] = await Promise.all([
    prisma.scoutTemplate.findMany({ orderBy: templateOrderBy }),
    prisma.scoutCondition.groupBy({
      by: ["templateId"],
      where: { templateId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const usageById: Record<string, number> = {};
  for (const u of usage) if (u.templateId) usageById[u.templateId] = u._count._all;

  const res: TemplatesResponse = { templates: templates.map(toTemplateDto), usageById };
  return NextResponse.json(res);
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const parsed = parseTemplateInput(body as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // 名前は CSV 取り込みの突き合わせキーでもあるので、種別が違っても重複させない
  const dup = await prisma.scoutTemplate.findFirst({ where: { name: parsed.data.name } });
  if (dup) return NextResponse.json({ error: "同じ名前のテンプレートが既にあります" }, { status: 409 });

  // 種別内の並びは末尾に足す（既存の並びを崩さない）
  const maxSort = await prisma.scoutTemplate.aggregate({ where: { kind: parsed.data.kind }, _max: { sortOrder: true } });
  const created = await createScoutTemplate({ ...parsed.data, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 });
  return NextResponse.json({ template: toTemplateDto(created) });
}

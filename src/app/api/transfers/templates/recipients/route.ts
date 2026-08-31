// T-185: セキュアファイル送信の宛先テンプレート（企業＋担当者）一覧・作成API。
// - 共有範囲は全社共有: 一覧・使用・編集は全社員可。アーカイブのみ作成者本人と admin（[id]/route.ts で判定）。
// - 物理削除はしない（isArchived の論理削除のみ）。
// middleware は /api/ を素通しするため、認証はこのルートで行う（漏れ禁止）。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  ContactInput,
  normalizeContacts,
  resolveUserNames,
} from "@/lib/secure-transfer-template-api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";

  const templates = await prisma.secureTransferRecipientTemplate.findMany({
    where: includeArchived ? {} : { isArchived: false },
    orderBy: [{ isArchived: "asc" }, { companyName: "asc" }, { name: "asc" }],
    include: { contacts: { orderBy: { sortOrder: "asc" } } },
  });

  const names = await resolveUserNames(templates.map((t) => t.createdByUserId));

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      companyName: t.companyName,
      memo: t.memo,
      createdByUserId: t.createdByUserId,
      createdByName: names.get(t.createdByUserId) ?? "（退職・不明）",
      lastUsedAt: t.lastUsedAt,
      isArchived: t.isArchived,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      // アーカイブ操作の可否（表示制御用。API側でも同じ判定を行う）
      canArchive: t.createdByUserId === user.id || user.role === "admin",
      contacts: t.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        defaultField: c.defaultField,
        sortOrder: c.sortOrder,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    companyName?: string;
    memo?: string;
    contacts?: ContactInput[];
  } | null;

  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "テンプレート名を入力してください" }, { status: 400 });
  }

  const normalized = normalizeContacts(body?.contacts);
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const created = await prisma.secureTransferRecipientTemplate.create({
    data: {
      name,
      companyName: body?.companyName?.trim() || null,
      memo: body?.memo?.trim() || null,
      createdByUserId: user.id,
      contacts: { create: normalized.contacts },
    },
    select: { id: true },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

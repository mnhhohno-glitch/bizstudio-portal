// T-185: セキュアファイル送信の文面テンプレート一覧・作成API。
// - 保存するのは自由文部分（件名・本文・署名）のみ。固定生成部（URL・パスワード・有効期限・ファイル名）は
//   保存を拒否する（findForbiddenFixedBlockMarker・確定仕様）。
// - 共有範囲は全社共有。アーカイブのみ作成者本人と admin（[id]/route.ts で判定）。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  findForbiddenFixedBlockMarker,
  resolveUserNames,
} from "@/lib/secure-transfer-template-api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";

  const templates = await prisma.secureTransferMessageTemplate.findMany({
    where: includeArchived ? {} : { isArchived: false },
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
  });

  const names = await resolveUserNames(templates.map((t) => t.createdByUserId));

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      body: t.body,
      signature: t.signature,
      createdByUserId: t.createdByUserId,
      createdByName: names.get(t.createdByUserId) ?? "（退職・不明）",
      lastUsedAt: t.lastUsedAt,
      isArchived: t.isArchived,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      canArchive: t.createdByUserId === user.id || user.role === "admin",
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
    subject?: string;
    body?: string;
    signature?: string | null;
  } | null;

  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "テンプレート名を入力してください" }, { status: 400 });
  }
  const subject = body?.subject?.trim() ?? "";
  const bodyText = body?.body ?? "";
  if (!subject && !bodyText.trim()) {
    return NextResponse.json(
      { error: "件名または本文のどちらかを入力してください" },
      { status: 400 }
    );
  }

  const signature =
    typeof body?.signature === "string" && body.signature.trim() ? body.signature : null;

  // 固定生成部の混入チェック（過去メールの全文貼り付けによる URL・パスワードの固定保存を防ぐ）
  const marker = findForbiddenFixedBlockMarker(subject, bodyText, signature);
  if (marker) {
    return NextResponse.json(
      {
        error: `本文に自動挿入部分（${marker}）が含まれています。URL・パスワード・有効期限・ファイル名は送信のたびに自動生成されるため、テンプレートには自由文部分だけを保存してください`,
      },
      { status: 400 }
    );
  }

  const created = await prisma.secureTransferMessageTemplate.create({
    data: {
      name,
      subject,
      body: bodyText,
      signature,
      createdByUserId: user.id,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

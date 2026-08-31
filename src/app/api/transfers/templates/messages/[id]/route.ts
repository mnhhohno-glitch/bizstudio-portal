// T-185: 文面テンプレートの更新・アーカイブAPI。
// - 内容の編集は全社員可（全社共有・確定仕様）。isArchived の変更だけは作成者本人と admin のみ。
// - 固定生成部（■ダウンロードURL 等）の混入は作成時と同様に拒否する。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { findForbiddenFixedBlockMarker } from "@/lib/secure-transfer-template-api";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const template = await prisma.secureTransferMessageTemplate.findUnique({
    where: { id },
    select: { id: true, createdByUserId: true, isArchived: true },
  });
  if (!template) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    subject?: string;
    body?: string;
    signature?: string | null;
    isArchived?: boolean;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (
    typeof body.isArchived === "boolean" &&
    body.isArchived !== template.isArchived &&
    template.createdByUserId !== user.id &&
    user.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "アーカイブできるのは作成者本人と管理者のみです" },
      { status: 403 }
    );
  }

  const data: {
    name?: string;
    subject?: string;
    body?: string;
    signature?: string | null;
    isArchived?: boolean;
  } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "テンプレート名を入力してください" }, { status: 400 });
    }
    data.name = name;
  }
  if (typeof body.subject === "string") data.subject = body.subject.trim();
  if (typeof body.body === "string") data.body = body.body;
  if (body.signature !== undefined) {
    data.signature =
      typeof body.signature === "string" && body.signature.trim() ? body.signature : null;
  }
  if (typeof body.isArchived === "boolean") data.isArchived = body.isArchived;

  const marker = findForbiddenFixedBlockMarker(data.subject, data.body, data.signature);
  if (marker) {
    return NextResponse.json(
      {
        error: `本文に自動挿入部分（${marker}）が含まれています。URL・パスワード・有効期限・ファイル名は送信のたびに自動生成されるため、テンプレートには自由文部分だけを保存してください`,
      },
      { status: 400 }
    );
  }

  await prisma.secureTransferMessageTemplate.update({ where: { id }, data });

  return NextResponse.json({ ok: true });
}

// T-185: 宛先テンプレートの更新・アーカイブAPI。
// - 内容の編集（名前・企業名・メモ・担当者）は全社員可（全社共有・確定仕様）。
// - isArchived の変更（アーカイブ・復元）だけは作成者本人と admin のみ。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { ContactInput, normalizeContacts } from "@/lib/secure-transfer-template-api";

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
  const template = await prisma.secureTransferRecipientTemplate.findUnique({
    where: { id },
    select: { id: true, createdByUserId: true, isArchived: true },
  });
  if (!template) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    companyName?: string | null;
    memo?: string | null;
    contacts?: ContactInput[];
    isArchived?: boolean;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // アーカイブ・復元は作成者本人と admin のみ（確定仕様）
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
    companyName?: string | null;
    memo?: string | null;
    isArchived?: boolean;
  } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "テンプレート名を入力してください" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.companyName !== undefined) {
    data.companyName = typeof body.companyName === "string" ? body.companyName.trim() || null : null;
  }
  if (body.memo !== undefined) {
    data.memo = typeof body.memo === "string" ? body.memo.trim() || null : null;
  }
  if (typeof body.isArchived === "boolean") {
    data.isArchived = body.isArchived;
  }

  let normalizedContacts: ReturnType<typeof normalizeContacts> | null = null;
  if (body.contacts !== undefined) {
    normalizedContacts = normalizeContacts(body.contacts);
    if ("error" in normalizedContacts) {
      return NextResponse.json({ error: normalizedContacts.error }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.secureTransferRecipientTemplate.update({ where: { id }, data });
    if (normalizedContacts && "contacts" in normalizedContacts) {
      // 担当者は全置き換え（行の追加・削除・並べ替えをUI側の配列順そのままで反映する）
      await tx.secureTransferRecipientContact.deleteMany({ where: { templateId: id } });
      await tx.secureTransferRecipientContact.createMany({
        data: normalizedContacts.contacts.map((c) => ({ ...c, templateId: id })),
      });
    }
  });

  return NextResponse.json({ ok: true });
}

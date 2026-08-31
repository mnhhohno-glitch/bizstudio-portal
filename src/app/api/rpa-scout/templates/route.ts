import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { TEMPLATE_KIND_VALUES } from "@/lib/rpa-scout/constants";

// 状況ボード・カレンダーの件名選択と、テンプレート管理画面が共通で使う一覧。
// 停止分も返し、選択用の絞り込み（isActive）は呼び出し側で行う（既存の挙動を変えない）
export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const templates = await prisma.rpaScoutSubjectTemplate.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      subject: true,
      body: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  // 本文は改行をそのまま保存する（trimは前後の空行のみ）
  const mailBody = typeof body.body === "string" ? body.body.trim() : "";
  const kind =
    typeof body.kind === "string" && TEMPLATE_KIND_VALUES.includes(body.kind) ? body.kind : null;

  if (!name) return NextResponse.json({ error: "テンプレ名は必須です" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "件名は必須です" }, { status: 400 });
  if (!mailBody) return NextResponse.json({ error: "本文は必須です" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "種別は必須です" }, { status: 400 });

  // 同名は警告のみ（パターン管理と同じ挙動。保存は通す）
  const duplicate = await prisma.rpaScoutSubjectTemplate.findFirst({
    where: { name, isActive: true },
    select: { id: true },
  });

  const template = await prisma.rpaScoutSubjectTemplate.create({
    data: { name, kind, subject, body: mailBody, isActive: true },
  });

  return NextResponse.json({ template, duplicateWarning: !!duplicate });
}

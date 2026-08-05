import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// URL は「/」始まりの内部パス、または http(s):// 始まりのみ許可
// route.ts は HTTP メソッド以外を export できないためファイル内定義（[id]/route.ts にも同一実装あり）
function isValidMaterialUrl(url: string): boolean {
  return /^\//.test(url) || /^https?:\/\//.test(url);
}

// 一覧取得: ログイン済み全員。admin 以外は公開中のみ返す
export async function GET() {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const materials = await prisma.trainingMaterial.findMany({
    where: actor.role === "admin" ? {} : { isPublished: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ materials, isAdmin: actor.role === "admin" });
}

// 新規作成: admin のみ
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, category, url, tag, sortOrder, isPublished } = body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
  }
  if (!category || typeof category !== "string" || category.trim().length === 0) {
    return NextResponse.json({ error: "カテゴリは必須です" }, { status: 400 });
  }
  if (!url || typeof url !== "string" || !isValidMaterialUrl(url.trim())) {
    return NextResponse.json(
      { error: "URLは / 始まりの内部パス、または http(s):// 始まりで入力してください" },
      { status: 400 }
    );
  }
  if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isFinite(sortOrder))) {
    return NextResponse.json({ error: "表示順は数値で入力してください" }, { status: 400 });
  }

  const material = await prisma.trainingMaterial.create({
    data: {
      title: title.trim(),
      description: typeof description === "string" && description.trim().length > 0 ? description.trim() : null,
      category: category.trim(),
      url: url.trim(),
      tag: typeof tag === "string" && tag.trim().length > 0 ? tag.trim() : null,
      sortOrder: typeof sortOrder === "number" ? Math.trunc(sortOrder) : 0,
      isPublished: isPublished !== false,
    },
  });

  return NextResponse.json(material);
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

// 改修③（途中保存）: 面談前フォームの質問下書きの取得/保存/削除。
// - candidateId はルートパラメータ＝Candidate.id。FormDraft.candidateId（@unique）に一致させる。
// - 求職者ごとに1件・PUT で upsert・フォーム作成成功時に DELETE される（モーダル側）。

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { candidateId } = await params;
    const draft = await prisma.formDraft.findUnique({ where: { candidateId } });
    if (!draft) return NextResponse.json({ draft: null });

    return NextResponse.json({
      draft: {
        questionsJson: draft.questionsJson,
        updatedAt: draft.updatedAt.toISOString(),
      },
    });
  } catch (e) {
    console.error("[google-form/draft][GET] error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { candidateId } = await params;
    const body = await req.json().catch(() => null);
    const questionsJson = body?.questionsJson;
    if (!questionsJson || typeof questionsJson !== "object") {
      return NextResponse.json({ error: "questionsJson は必須です" }, { status: 400 });
    }

    // 求職者の存在チェック（不正な candidateId で孤立した下書きを作らない）
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!candidate) {
      return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    }

    const draft = await prisma.formDraft.upsert({
      where: { candidateId },
      create: { candidateId, questionsJson },
      update: { questionsJson },
    });

    return NextResponse.json({ ok: true, updatedAt: draft.updatedAt.toISOString() });
  } catch (e) {
    console.error("[google-form/draft][PUT] error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { candidateId } = await params;
    // deleteMany: 下書きが無くても例外を投げない（フォーム作成成功時の自動削除を冪等にする）。
    await prisma.formDraft.deleteMany({ where: { candidateId } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[google-form/draft][DELETE] error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

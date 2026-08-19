import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  GOOGLE_FORM_REQUEST_CATEGORY,
  GOOGLE_FORM_REQUEST_DATA_LABEL,
} from "@/constants/google-form-request";

export const runtime = "nodejs";

// T-171: 当該求職者の「Googleフォーム作成依頼」カテゴリで未完了
// （NOT_STARTED / IN_PROGRESS）のタスクのうち最新1件を返す。
// Google フォーム作成モーダルが open 時に呼び、「フォーム作成指定データ」の JSON を
// 初期選択・extract 省略に使う。依頼が無い/JSONが壊れている場合は request: null。
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { candidateId } = await params;

    const task = await prisma.task.findFirst({
      where: {
        candidateId,
        status: { in: ["NOT_STARTED", "IN_PROGRESS"] },
        category: { name: GOOGLE_FORM_REQUEST_CATEGORY },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        createdByUser: { select: { name: true } },
        fieldValues: {
          select: { value: true, field: { select: { label: true } } },
        },
      },
    });

    if (!task) return NextResponse.json({ request: null });

    const dataFv = task.fieldValues.find(
      (fv) => fv.field.label === GOOGLE_FORM_REQUEST_DATA_LABEL,
    );
    if (!dataFv?.value) return NextResponse.json({ request: null });

    let data: unknown = null;
    try {
      data = JSON.parse(dataFv.value);
    } catch {
      // 機械用 JSON が壊れている依頼は無かったことにする（モーダルは通常フロー）
      return NextResponse.json({ request: null });
    }

    return NextResponse.json({
      request: {
        taskId: task.id,
        title: task.title,
        status: task.status,
        createdAt: task.createdAt.toISOString(),
        createdByName: task.createdByUser?.name ?? null,
        data,
      },
    });
  } catch (e) {
    console.error("[google-form/request][GET] error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

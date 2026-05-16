import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { notifyMynaviBatchCompletion, notifyMynaviError } from "@/lib/mynavi-rpa/notify";

export const runtime = "nodejs";

/**
 * POST /api/rpa/mynavi/batch-finish
 * RPA バッチ完了通知。処理ログを集計し、バッチを確定して LINE WORKS 通知する。
 */
export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batchId: string = String(body?.batchId || "");
    const errorMessage: string | null = body?.errorMessage
      ? String(body.errorMessage)
      : null;

    if (!batchId) {
      return NextResponse.json({ error: "batchId は必須です" }, { status: 400 });
    }

    const batch = await prisma.rpaExecutionBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      return NextResponse.json(
        { error: "指定されたバッチが見つかりません" },
        { status: 404 },
      );
    }

    // status 別件数を集計
    const grouped = await prisma.mynaviRpaProcessingLog.groupBy({
      by: ["status"],
      where: { batchId },
      _count: { _all: true },
    });
    const countOf = (s: string) =>
      grouped.find((g) => g.status === s)?._count._all ?? 0;

    const normalCount = countOf("NORMAL");
    const ageNgCount = countOf("AGE_NG");
    const foreignNgCount = countOf("FOREIGN_NG");
    const aiFailedCount = countOf("AI_FAILED");
    const duplicateSkipCount = countOf("DUPLICATE_SKIP");
    const errorCount = countOf("ERROR");
    const totalCount =
      normalCount +
      ageNgCount +
      foreignNgCount +
      aiFailedCount +
      duplicateSkipCount +
      errorCount;

    const updated = await prisma.rpaExecutionBatch.update({
      where: { id: batchId },
      data: {
        finishedAt: new Date(),
        status: errorMessage ? "FAILED" : "COMPLETED",
        errorMessage,
        totalCount,
        normalCount,
        ageNgCount,
        foreignNgCount,
        aiFailedCount,
        duplicateSkipCount,
        errorCount,
      },
    });

    await notifyMynaviBatchCompletion(updated);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[rpa/mynavi/batch-finish] error:", e);
    const message = e instanceof Error ? e.message : String(e);
    await notifyMynaviError(`バッチ完了処理に失敗しました`, { detail: message });
    return NextResponse.json(
      { error: `予期しないエラー: ${message}` },
      { status: 500 },
    );
  }
}

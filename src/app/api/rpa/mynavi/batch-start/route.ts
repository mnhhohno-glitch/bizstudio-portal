import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { closeStaleNoTargetBatches } from "@/lib/mynavi-rpa/no-target";

export const runtime = "nodejs";

/**
 * POST /api/rpa/mynavi/batch-start
 * RPA バッチ開始時に呼び出し、RpaExecutionBatch を作成して batchId を返す。
 */
export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const machineNumber: number =
      typeof body?.machineNumber === "number" ? body.machineNumber : 7;
    const flowName: string =
      typeof body?.flowName === "string" && body.flowName.trim()
        ? body.flowName
        : "01.応募者一次返信・情報取り込み";

    const batch = await prisma.rpaExecutionBatch.create({
      data: {
        machineNumber,
        flowName,
        startedAt: new Date(),
        status: "RUNNING",
      },
    });

    // T-168: 空振り（取り込み対象0件）で RUNNING のまま残った過去バッチをここで畳む。
    // 掃除に失敗しても batch-start 本体は成功させる。
    try {
      const closed = await closeStaleNoTargetBatches(prisma, {
        excludeBatchIds: [batch.id],
      });
      console.log(
        `[rpa/mynavi/batch-start] no-target cleanup: closed=${closed.count} ` +
          `staleMinutes=${closed.staleMinutes} limit=${closed.limit} ` +
          `threshold=${closed.threshold.toISOString()}`,
      );
    } catch (e) {
      console.error("[rpa/mynavi/batch-start] no-target cleanup failed:", e);
    }

    return NextResponse.json({ batchId: batch.id });
  } catch (e) {
    console.error("[rpa/mynavi/batch-start] error:", e);
    await notifyMynaviError(
      `バッチ開始に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    );
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

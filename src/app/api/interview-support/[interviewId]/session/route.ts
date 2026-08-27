// T-183 Phase 2: 面談サポートセッションの保存API。
// - クライアント生成の sessionId を主キーとした upsert（丸ごと上書き）。1分ごとの定期保存が
//   何度走っても重複レコードにならない（冪等）。
// - transcript / explanations / endedAt は毎回全量で上書きする（部分マージはしない）。
//   停止→再開したセッションでは endedAt を null に戻す必要があるため、endedAt 未指定は null として扱う。
// - createdByUserId は Employee.id（employees テーブルの FK）。セッションの user.id は User.id で
//   ID 空間が別なので、面談レコード作成API と同じく Employee に変換してから渡す。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

type SaveBody = {
  sessionId?: string;
  startedAt?: string;
  endedAt?: string | null;
  transcript?: unknown;
  explanations?: unknown;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { interviewId } = await params;
  const body = (await req.json()) as SaveBody;

  const sessionId = (body.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  const startedAt = body.startedAt ? new Date(body.startedAt) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "startedAt is required" }, { status: 400 });
  }
  const endedAt = body.endedAt ? new Date(body.endedAt) : null;
  if (endedAt && Number.isNaN(endedAt.getTime())) {
    return NextResponse.json({ error: "endedAt が不正です" }, { status: 400 });
  }
  if (!Array.isArray(body.transcript) || !Array.isArray(body.explanations)) {
    return NextResponse.json({ error: "transcript / explanations は配列で指定してください" }, { status: 400 });
  }

  const record = await prisma.interviewRecord.findUnique({
    where: { id: interviewId },
    select: { id: true },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  // createdByUserId は employees(id) 参照。User.id をそのまま入れると FK 違反になる。
  const employee = await prisma.employee.findFirst({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "社員情報が見つかりません" }, { status: 400 });
  }

  const transcript = body.transcript as Prisma.InputJsonValue;
  const explanations = body.explanations as Prisma.InputJsonValue;

  try {
    const session = await prisma.interviewSupportSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        interviewRecordId: interviewId,
        // 作成者は初回のまま（update 側では触らない）。
        createdByUserId: employee.id,
        startedAt,
        endedAt,
        transcript,
        explanations,
      },
      update: {
        endedAt,
        transcript,
        explanations,
      },
    });

    return NextResponse.json({ sessionId: session.id, updatedAt: session.updatedAt });
  } catch (e) {
    // 調査を速くするため、エラー種別が分かる短いメッセージだけ返す（スタックは返さない）。
    const code = (e as { code?: string })?.code;
    const detail = code ? `DBエラー (${code})` : "DBエラー";
    console.error("[interview-support/session] save failed", { sessionId, interviewId, code, error: e });
    return NextResponse.json({ error: `保存に失敗しました: ${detail}` }, { status: 500 });
  }
}

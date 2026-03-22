import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { sendBotMessage } from "@/lib/lineworks";

export async function GET(req: Request) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const machineNumber = searchParams.get("machineNumber");
  const flowName = searchParams.get("flowName");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20", 10));

  const where: Prisma.RpaErrorLogWhereInput = {};
  if (machineNumber) where.machineNumber = parseInt(machineNumber, 10);
  if (flowName) where.flowName = flowName;
  if (status) where.status = status;
  if (from || to) {
    where.occurredAt = {};
    if (from) where.occurredAt.gte = new Date(from);
    if (to) where.occurredAt.lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    prisma.rpaErrorLog.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        knownError: { select: { patternName: true } },
        registeredUser: { select: { name: true } },
      },
    }),
    prisma.rpaErrorLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
}

export async function POST(req: Request) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { machineNumber, flowName, errorSummary, status, severity, occurredAt, chatId, knownErrorId } = body;

  if (!machineNumber || !flowName || !errorSummary || !occurredAt) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  const log = await prisma.rpaErrorLog.create({
    data: {
      machineNumber,
      flowName,
      errorSummary,
      status: status || "未対応",
      severity: severity || null,
      occurredAt: new Date(occurredAt),
      chatId: chatId || null,
      knownErrorId: knownErrorId || null,
      registeredBy: actor.id,
    },
  });

  // LINE WORKS通知
  try {
    const botId = process.env.LINEWORKS_RPA_BOT_ID;
    const roomId = process.env.LINEWORKS_RPA_ROOM_ID;
    const baseUrl = process.env.PORTAL_BASE_URL;

    if (botId && roomId) {
      const summaryShort = errorSummary.length > 100
        ? errorSummary.slice(0, 100) + "..."
        : errorSummary;

      const message = [
        "🔴 RPAエラー登録",
        "",
        `号機: ${machineNumber}号機`,
        `フロー: ${flowName}`,
        `深刻度: ${severity || "未分類"}`,
        `概要: ${summaryShort}`,
        "",
        `▶ 詳細を確認: ${baseUrl}/rpa-error/logs/${log.id}`,
      ].join("\n");

      await sendBotMessage(botId, roomId, message);
    }
  } catch (e) {
    console.error("RPA LINE WORKS通知失敗:", e);
  }

  return NextResponse.json({ id: log.id }, { status: 201 });
}

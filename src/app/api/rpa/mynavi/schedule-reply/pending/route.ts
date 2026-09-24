// T-196 step1: GET /api/rpa/mynavi/schedule-reply/pending
// 7号機RPA（日程調整の返信だけを行う小さなRPA）が「次に送るぶん」を取りに来る受け口。
//
// 認証: x-rpa-secret（既存 /api/rpa/mynavi/* と同じ verifyRpaSecret）。
// portal は **送らない**。文面と会員No.を渡すだけで、マイナビ操作はすべて RPA 側の責務。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { toJstIso } from "@/lib/schedule-tasks";
import { extractCandidateName } from "@/lib/schedule-agent/parse-preferences";
import {
  MYNAVI_REPLY_FAILED_PREFIX,
  MYNAVI_REPLY_MAX_FAILURES,
  MYNAVI_REPLY_PENDING_WINDOW_DAYS,
} from "@/lib/schedule-agent/mynavi-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG = "[mynavi-schedule-reply/pending]";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * 3回失敗ぶんを落とすため、limit より多めに引いてから絞る。
 * 失敗が積まれた行が先頭に溜まっても limit 件を返し切れるようにする倍率。
 */
const OVERFETCH_FACTOR = 4;

export async function GET(req: Request) {
  if (!verifyRpaSecret(req)) {
    console.warn(`${LOG} unauthorized`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  let limit = DEFAULT_LIMIT;
  const limitRaw = sp.get("limit");
  if (limitRaw != null && limitRaw.trim() !== "") {
    const n = parseInt(limitRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "limit は正の整数で指定してください" }, { status: 400 });
    }
    limit = Math.min(n, MAX_LIMIT);
  }

  const since = new Date(Date.now() - MYNAVI_REPLY_PENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.task.findMany({
    where: {
      mynaviReplyText: { not: null },
      mynaviReplySentAt: null,
      // 送信結果が不明（要目視確認）の行は二度と出さない。自動再送すると
      // 実際には送れていた人へ同じメッセージが重ねて届くため、人の目視に委ねる。
      mynaviReplyUnconfirmedAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit * OVERFETCH_FACTOR, MAX_LIMIT * OVERFETCH_FACTOR),
    select: {
      id: true,
      title: true,
      createdAt: true,
      mynaviReplyText: true,
      mynaviReplySubject: true,
      mynaviReplyMemberNo: true,
      candidate: { select: { name: true } },
    },
  });

  // 失敗コメントが MYNAVI_REPLY_MAX_FAILURES 件以上のタスクは対象から外す（同じ行を掴み続けさせない）。
  const failureCounts = new Map<string, number>();
  if (rows.length > 0) {
    const grouped = await prisma.taskComment.groupBy({
      by: ["taskId"],
      where: {
        taskId: { in: rows.map((r) => r.id) },
        content: { contains: MYNAVI_REPLY_FAILED_PREFIX },
      },
      _count: { _all: true },
    });
    for (const g of grouped) failureCounts.set(g.taskId, g._count._all);
  }

  const items = rows
    .filter((r) => (failureCounts.get(r.id) ?? 0) < MYNAVI_REPLY_MAX_FAILURES)
    .slice(0, limit)
    .map((r) => ({
      taskId: r.id,
      candidateName: r.candidate?.name ?? extractCandidateName(r.title) ?? "",
      memberNo: r.mynaviReplyMemberNo ?? "",
      subject: r.mynaviReplySubject ?? "",
      text: r.mynaviReplyText ?? "",
      createdAt: toJstIso(r.createdAt),
    }));

  console.log(`${LOG} returned=${items.length} scanned=${rows.length} limit=${limit}`);
  return NextResponse.json({ items });
}

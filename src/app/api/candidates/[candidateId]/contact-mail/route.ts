// T-207: 求職者向け案内メール（LINE登録案内・あいさつメール）の確認・送信 API。
// 認証は既存の求職者 API と同じ getSessionUser()（未ログイン 403）。
//
// GET  ?type=line|greeting … 種類を指定すると差し込み済みの件名・本文（確認画面用）を返す。
//      type 無し           … メニュー用に種類ごとの「送れるか・理由・最終送信日時」だけ返す。
// POST { type, resend? }  … 送信。送れない理由があれば 400 で理由を返す。
//      同じ求職者に同じ種類の送信記録があり resend が true でなければ 409（二重送信の防止）。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { CONTACT_MAIL_TYPES, isContactMailType, type ContactMailType } from "@/lib/candidate-mail/templates";
import {
  buildContactMailFrom,
  buildContactMailPreview,
  checkCanSend,
  findLastSentAt,
  resolveSender,
  sendContactMail,
} from "@/lib/candidate-mail/send";

async function loadContext(candidateId: string) {
  const actor = await getSessionUser();
  if (!actor) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true, email: true },
  });
  if (!candidate) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;

  const sender = await resolveSender(actor);
  return { actor, candidate, sender } as const;
}

export async function GET(req: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const ctx = await loadContext(candidateId);
  if ("error" in ctx) return ctx.error;
  const { candidate, sender } = ctx;

  const typeParam = new URL(req.url).searchParams.get("type");
  if (typeParam !== null && !isContactMailType(typeParam)) {
    return NextResponse.json({ error: "type は line か greeting を指定してください" }, { status: 400 });
  }

  const lastSentAt = await findLastSentAt(candidateId);
  const items: Record<string, { canSend: boolean; reason: string | null; lastSentAt: string | null }> = {};
  for (const t of CONTACT_MAIL_TYPES) {
    const c = checkCanSend(t, candidate, sender);
    items[t] = { canSend: c.canSend, reason: c.canSend ? null : c.reason, lastSentAt: lastSentAt[t]?.toISOString() ?? null };
  }

  const base = {
    candidate: { id: candidate.id, name: candidate.name, email: candidate.email },
    sender: { email: sender.email, name: sender.name, familyName: sender.familyName, from: buildContactMailFrom(sender) },
    items,
  };
  if (!typeParam) return NextResponse.json(base);

  const type = typeParam as ContactMailType;
  const preview = await buildContactMailPreview(type, candidate, sender);
  return NextResponse.json({ ...base, type, preview });
}

export async function POST(req: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const ctx = await loadContext(candidateId);
  if ("error" in ctx) return ctx.error;
  const { candidate, sender } = ctx;

  const body = (await req.json().catch(() => null)) as { type?: unknown; resend?: unknown } | null;
  if (!body || !isContactMailType(body.type)) {
    return NextResponse.json({ error: "type は line か greeting を指定してください" }, { status: 400 });
  }
  const type = body.type;
  const resend = body.resend === true;

  const check = checkCanSend(type, candidate, sender);
  if (!check.canSend) {
    return NextResponse.json({ error: check.reason, code: "cannot_send" }, { status: 400 });
  }

  const lastSentAt = (await findLastSentAt(candidateId))[type];
  if (lastSentAt && !resend) {
    return NextResponse.json(
      { error: "すでに送信済みです。もう一度送る場合は resend を指定してください", code: "already_sent", lastSentAt: lastSentAt.toISOString() },
      { status: 409 },
    );
  }

  const result = await sendContactMail(type, { id: candidate.id, name: candidate.name, email: candidate.email!.trim() }, sender);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, type, logId: result.logId, messageId: result.messageId, sentAt: result.sentAt.toISOString() });
}

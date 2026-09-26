// T-205: 面談準備チャットの「最初の整理」を作る（SSE ストリーミング）。
//
// 流れ:
//   1. 有効な部屋が無ければ、マイナビレジュメを Drive から取得して pdf-parse で文字を取り出し、部屋を作る。
//      レジュメが無い／200字未満なら AI を呼ばず 422 を返す（部屋も作らない）。
//   2. 有効な部屋があり整理も済んでいれば 409（画面は状態取得で復元する）。整理が未保存（途中失敗）なら
//      保存済みの文字で作り直す（Drive も pdf-parse も呼ばない）。
//   3. body.rebuild=true は「作り直す」。文字を取り直してから古い部屋を非表示（archivedAt）にし、新しい部屋を作る。
//      取り直しに失敗したときは古い部屋を残す。
//   4. 応答を流し終えてから assistant の発言（kind=SUMMARY）を保存し、経歴の型を部屋に保存する。
//      途中で失敗したら何も保存しない（画面はエラーと「再送」を出す）。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { findLatestMynaviResume, extractResumeText } from "@/lib/interview-prep/resume";
import {
  INTERVIEW_PREP_MODEL,
  SUMMARY_MAX_TOKENS,
  buildPrepSystem,
  buildSummaryMessages,
  createPrepStream,
  extractCareerType,
} from "@/lib/interview-prep/chat";
import { sseResponse } from "@/lib/interview-prep/sse";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const { candidateId } = await params;
  const body = (await req.json().catch(() => ({}))) as { rebuild?: boolean };
  const rebuild = body.rebuild === true;

  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!candidate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const active = await prisma.interviewPrepRoom.findFirst({
    where: { candidateId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, resumeText: true, summaryMessageId: true },
  });

  let roomId: string;
  let resumeText: string;

  if (active && !rebuild) {
    if (active.summaryMessageId) {
      return NextResponse.json({ error: "already_summarized", roomId: active.id }, { status: 409 });
    }
    if (active.resumeText && active.resumeText.length > 0) {
      // 途中失敗の再送: 保存済みの文字で作り直す
      roomId = active.id;
      resumeText = active.resumeText;
    } else {
      // 文字が無い部屋（想定外）は非表示にして作り直す
      await prisma.interviewPrepRoom.update({ where: { id: active.id }, data: { archivedAt: new Date() } });
      const created = await createRoomWithResume(candidateId, actor.id);
      if (!created.ok) return created.response;
      roomId = created.roomId;
      resumeText = created.resumeText;
    }
  } else {
    const created = await createRoomWithResume(candidateId, actor.id, active?.id ?? null);
    if (!created.ok) return created.response;
    roomId = created.roomId;
    resumeText = created.resumeText;
  }

  const system = buildPrepSystem(resumeText);
  const messages = buildSummaryMessages();
  const startedAt = Date.now();

  return sseResponse(async (send) => {
    send({ started: true, roomId });
    let text = "";
    try {
      const stream = createPrepStream({ system, messages, maxTokens: SUMMARY_MAX_TOKENS });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          send({ text: event.delta.text });
        }
      }
      const final = await stream.finalMessage();
      const latencyMs = Date.now() - startedAt;
      await recordAdvisorUsage({
        endpoint: "interview-prep-summary",
        model: INTERVIEW_PREP_MODEL,
        usage: final.usage,
        candidateId,
        latencyMs,
        note: rebuild ? "rebuild" : null,
      });
      const u = final.usage;
      console.log(
        `[interview-prep summary] input=${u.input_tokens} output=${u.output_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} latency_ms=${latencyMs}`,
      );
      if (!text.trim()) {
        send({ error: "応答が空でした。もう一度お試しください。" });
        return;
      }
      const careerType = extractCareerType(text);
      const saved = await prisma.$transaction(async (tx) => {
        const msg = await tx.interviewPrepMessage.create({
          data: { roomId, role: "assistant", content: text, kind: "SUMMARY" },
          select: { id: true, content: true, createdAt: true },
        });
        await tx.interviewPrepRoom.update({
          where: { id: roomId },
          data: { summaryMessageId: msg.id, careerType },
        });
        return msg;
      });
      send({ done: true, roomId, summary: saved, careerType });
    } catch (e) {
      console.error("[interview-prep summary] failed:", e);
      const status = (e as { status?: number })?.status;
      await recordAdvisorUsage({
        endpoint: "interview-prep-summary",
        model: INTERVIEW_PREP_MODEL,
        usage: null,
        candidateId,
        latencyMs: Date.now() - startedAt,
        note: `error-${status ?? "unknown"}`,
      });
      send({
        error:
          status === 429
            ? "APIのレート制限に達しました。少し待ってから再送してください。"
            : "AI の応答取得に失敗しました。再送してください。",
      });
    }
  });
}

type CreateResult =
  | { ok: true; roomId: string; resumeText: string }
  | { ok: false; response: NextResponse };

/** レジュメの文字を取り出して部屋を作る。archivePreviousId を渡すと、取り出し成功後にその部屋を非表示にする。 */
async function createRoomWithResume(
  candidateId: string,
  userId: string,
  archivePreviousId: string | null = null,
): Promise<CreateResult> {
  const file = await findLatestMynaviResume(candidateId);
  if (!file) {
    return { ok: false, response: NextResponse.json({ error: "no_resume" }, { status: 422 }) };
  }
  const extracted = await extractResumeText(file);
  if (!extracted.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "resume_unreadable", reason: extracted.reason, chars: extracted.chars }, { status: 422 }),
    };
  }
  const now = new Date();
  const room = await prisma.$transaction(async (tx) => {
    if (archivePreviousId) {
      await tx.interviewPrepRoom.updateMany({
        where: { candidateId, archivedAt: null },
        data: { archivedAt: now },
      });
    }
    return tx.interviewPrepRoom.create({
      data: {
        candidateId,
        createdByUserId: userId,
        resumeFileId: file.id,
        resumeText: extracted.text,
        resumeImportedAt: file.createdAt,
        resumeExtractedAt: now,
      },
      select: { id: true },
    });
  });
  return { ok: true, roomId: room.id, resumeText: extracted.text };
}

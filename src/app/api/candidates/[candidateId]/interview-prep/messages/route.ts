// T-205: 面談準備チャットの質問1往復（SSE ストリーミング）。
//
// - 有効な部屋に最初の整理が無ければ 409（先に summary を作る）。
// - 送る中身は system＝指示本文＋レジュメ、messages＝［固定文→整理］＋直近10往復＋今回の質問（chat.ts）。
// - 応答を流し終えてから CA の発言と AI の発言をまとめて保存する。途中で失敗したら両方とも保存しない
//   （画面はエラーと「再送」を出し、再送で同じ質問を送り直す＝二重保存にならない）。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import {
  INTERVIEW_PREP_MODEL,
  CHAT_MAX_TOKENS,
  buildPrepSystem,
  buildChatMessages,
  createPrepStream,
  type PrepHistoryMessage,
} from "@/lib/interview-prep/chat";
import { sseResponse } from "@/lib/interview-prep/sse";

const MAX_QUESTION_CHARS = 8000;

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
  const body = (await req.json().catch(() => ({}))) as { content?: string };
  const question = (body.content ?? "").trim();
  if (!question) return NextResponse.json({ error: "メッセージが空です" }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: "メッセージが長すぎます" }, { status: 400 });
  }

  const room = await prisma.interviewPrepRoom.findFirst({
    where: { candidateId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, kind: true },
      },
    },
  });
  if (!room || !room.summaryMessageId || !room.resumeText) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }
  const summary = room.messages.find((m) => m.kind === "SUMMARY")?.content;
  if (!summary) return NextResponse.json({ error: "not_ready" }, { status: 409 });

  const history: PrepHistoryMessage[] = room.messages
    .filter((m) => m.kind !== "SUMMARY" && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const system = buildPrepSystem(room.resumeText);
  const messages = buildChatMessages(summary, history, question);
  const roomId = room.id;
  const askedAt = new Date();
  const startedAt = Date.now();

  return sseResponse(async (send) => {
    send({ started: true, roomId });
    let text = "";
    try {
      const stream = createPrepStream({ system, messages, maxTokens: CHAT_MAX_TOKENS });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          send({ text: event.delta.text });
        }
      }
      const final = await stream.finalMessage();
      const latencyMs = Date.now() - startedAt;
      await recordAdvisorUsage({
        endpoint: "interview-prep-chat",
        model: INTERVIEW_PREP_MODEL,
        usage: final.usage,
        candidateId,
        latencyMs,
      });
      const u = final.usage;
      console.log(
        `[interview-prep chat] input=${u.input_tokens} output=${u.output_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} latency_ms=${latencyMs}`,
      );
      if (!text.trim()) {
        send({ error: "応答が空でした。もう一度お試しください。" });
        return;
      }
      const saved = await prisma.$transaction(async (tx) => {
        const userMessage = await tx.interviewPrepMessage.create({
          data: { roomId, role: "user", userId: actor.id, content: question, createdAt: askedAt },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        const assistantMessage = await tx.interviewPrepMessage.create({
          data: { roomId, role: "assistant", content: text },
          select: { id: true, role: true, content: true, createdAt: true },
        });
        await tx.interviewPrepRoom.update({ where: { id: roomId }, data: { updatedAt: new Date() } });
        return { userMessage, assistantMessage };
      });
      send({
        done: true,
        userMessage: { ...saved.userMessage, userName: actor.name },
        assistantMessage: { ...saved.assistantMessage, userName: null },
      });
    } catch (e) {
      console.error("[interview-prep chat] failed:", e);
      const status = (e as { status?: number })?.status;
      await recordAdvisorUsage({
        endpoint: "interview-prep-chat",
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

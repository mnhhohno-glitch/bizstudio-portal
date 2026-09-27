// T-205: 面談準備チャットの「最初の整理」を作る（SSE ストリーミング）。
//
// 流れ:
//   1. 有効な部屋が無ければ、マイナビレジュメを Drive から取得して pdf-parse で文字を取り出し、部屋を作る。
//      レジュメが無い／200字未満なら AI を呼ばず 422 を返す（部屋も作らない）。
//   2. 有効な部屋があり整理も済んでいれば 409（画面は状態取得で復元する）。整理が未保存（途中失敗）なら
//      保存済みの文字で作り直す（Drive も pdf-parse も呼ばない）。
//   3. body.rebuild=true は「作り直す」。文字を取り直してから古い部屋を非表示（archivedAt）にし、新しい部屋を作る。
//      取り直しに失敗したときは古い部屋を残す。
//   4. 整理を作る直前に「会社と学校の下調べ」（ウェブ検索・research.ts）を1回行い、結果を部屋の research_json に保存する。
//      失敗（ウェブ検索が使えない・時間切れ・JSON が読めない）でも止めず、下調べなしで整理を作る。
//      「作り直す」は新しい部屋なので原則下調べからやり直す。ただし取り直したレジュメの文字が前の部屋と完全に同じで、
//      前の部屋の research_json の版が今の版（RESEARCH_VERSION）と同じなら、検索せずにその結果を新しい部屋にコピーする（step5）。
//      途中失敗の再送は、下調べ済みならその結果を使う（検索し直さない）。
//      step6: 会社と学校を別々の呼び出しで同時に調べる（research.ts）。使い回しは部分ごと（reusableResearchParts）で、
//      前の部屋（再送なら今の部屋自身）の該当部分が ok・文字も版も同じならその部分は調べない。
//      下調べ中は数秒おきに researchProgress を送り続ける（無通信が長いと途中の中継で接続が切られるため）。
//   5. 応答を流し終えてから assistant の発言（kind=SUMMARY）を保存し、経歴の型を部屋に保存する。
//      途中で失敗したら何も保存しない（画面はエラーと「再送」を出す）。
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import { runResearch, recordResearchUsage, type ResearchPart } from "@/lib/interview-prep/research";
import {
  reusableResearchParts,
  type ResearchPartStatus,
  type ResearchResult,
} from "@/lib/interview-prep/research-format";

/** 下調べ中に進み具合を送る間隔（ms）。 */
const RESEARCH_PROGRESS_INTERVAL_MS = 3_000;

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
    select: { id: true, resumeText: true, summaryMessageId: true, researchJson: true },
  });

  let roomId: string;
  let resumeText: string;
  // 下調べの使い回し元（再送は今の部屋・作り直しは前の部屋）。部分ごとに使えるかは reusableResearchParts で決める
  let reuseSource: { resumeText: string | null; researchJson: unknown } | null = null;

  if (active && !rebuild) {
    if (active.summaryMessageId) {
      return NextResponse.json({ error: "already_summarized", roomId: active.id }, { status: 409 });
    }
    if (active.resumeText && active.resumeText.length > 0) {
      // 途中失敗の再送: 保存済みの文字で作り直す
      roomId = active.id;
      resumeText = active.resumeText;
      reuseSource = active;
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
    // step5/6: 作り直しで文字も版も同じなら、前の部屋の下調べを（部分ごとに）使い回す
    if (rebuild) reuseSource = active;
  }

  const messages = buildSummaryMessages();

  return sseResponse(async (send) => {
    send({ started: true, roomId });

    // 下調べ（失敗しても止めない）
    const reuse = reusableResearchParts(reuseSource, resumeText);
    let research: ResearchResult;
    if (reuse.companies && reuse.school && reuse.research) {
      research = reuse.research;
      console.log("[interview-prep research] reused from previous room (same resume text and version)");
    } else {
      const progress: Record<ResearchPart, "running" | ResearchPartStatus> = {
        company: reuse.companies ? "ok" : "running",
        school: reuse.school ? "ok" : "running",
      };
      if (reuse.companies || reuse.school) {
        console.log(`[interview-prep research] partial reuse company=${reuse.companies} school=${reuse.school}`);
      }
      send({ researching: true, researchProgress: { ...progress } });
      const timer = setInterval(() => send({ researchProgress: { ...progress } }), RESEARCH_PROGRESS_INTERVAL_MS);
      let outcome: Awaited<ReturnType<typeof runResearch>>;
      try {
        outcome = await runResearch(resumeText, {
          reuse,
          onPartDone: (part, status) => {
            progress[part] = status;
            send({ researchProgress: { ...progress } });
          },
        });
      } finally {
        clearInterval(timer);
      }
      research = outcome.research;
      const parts = [outcome.parts.company, outcome.parts.school].filter((o) => o !== null);
      await Promise.all(parts.map((o) => recordResearchUsage(o, candidateId, rebuild)));
      for (const o of parts) {
        console.log(
          `[interview-prep research] part=${o.part} status=${o.status} searches=${o.webSearchRequests} input=${o.usage?.input_tokens ?? 0} output=${o.usage?.output_tokens ?? 0} latency_ms=${o.latencyMs}`,
        );
        if (o.status === "web_search_disabled") {
          console.warn(`[interview-prep research] web search is disabled for this organization: ${o.errorMessage}`);
        } else if (o.status !== "ok") {
          console.warn(`[interview-prep research] part=${o.part} failed: ${o.status} ${o.errorStatus ?? ""} ${o.errorMessage ?? ""}`);
        }
      }
      console.log(`[interview-prep research] total latency_ms=${outcome.latencyMs}`);
    }
    try {
      // 失敗した部分も状態付きで保存する（再送・作り直しでは ok の部分だけ使い回し、失敗した部分は調べ直す）
      await prisma.interviewPrepRoom.update({
        where: { id: roomId },
        data: { researchJson: research as unknown as Prisma.InputJsonValue, researchedAt: new Date() },
      });
    } catch (e) {
      console.error("[interview-prep research] save failed:", e);
    }
    send({ researched: true, research });

    const system = buildPrepSystem(resumeText, research);
    const startedAt = Date.now();
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
      send({ done: true, roomId, summary: saved, careerType, research });
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

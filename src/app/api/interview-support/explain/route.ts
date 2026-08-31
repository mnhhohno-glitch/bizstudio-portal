// T-183: 面談サポートのリアルタイムAI解説API。
// - 対象テキスト（直近30秒ログ or 選択文字列）＋固定指示文のみを送る。会話全ログは送らない。
// - CLAUDE_MODEL_FAST（Haiku）・拡張思考なし・max_tokens 固定で速度と分量を担保。
// - SSE でストリーミング転送（体感速度が生命線のため非ストリーミング応答は不可）。
// - usage は T-126 の流儀で AdvisorUsageLog に記録する。

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { anthropic, CLAUDE_MODEL_FAST } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

// 出力上限トークン。分量ルール（selection: 80〜120字 / recent: 最大3行）に合わせた初期値。実測で調整する。
const EXPLAIN_MAX_TOKENS = 250;
// 対象テキストの受け付け上限（暴走送信・コスト事故の防止。直近30秒の会話量として十分な幅）。
const MAX_INPUT_CHARS = 4000;

// 固定 system プロンプト。byte 一致でプロンプトキャッシュに乗せるため、動的要素は一切入れない。
const SYSTEM_PROMPT = `あなたは人材紹介会社のキャリアアドバイザー(CA)を支援するアシスタントです。
入力はCAと求職者の面談のリアルタイム文字起こしです。話者は混在し、誤字・認識ミスを含みます。文脈から補って読んでください。
求職者の仕事内容・業界用語・職種用語を、業界知識が全くない人向けに解説してください。
確証が持てない内容には「(推測)」と添えてください。

出力形式(厳守):
- 1行目は答えそのものから始める。「〇〇とは、」等の前置き・まとめ・免責は禁止。
- mode=selection: 結論1行+補足最大2行。全体80〜120字。
- mode=recent: 会話の要点を最大3行。`;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const body = (await req.json()) as { mode?: string; text?: string };
  const mode = body.mode;
  const text = (body.text ?? "").trim();
  if (mode !== "recent" && mode !== "selection") {
    return NextResponse.json({ error: "mode は recent または selection を指定してください" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: "text が長すぎます" }, { status: 400 });
  }

  const startedAt = Date.now();
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODEL_FAST,
    max_tokens: EXPLAIN_MAX_TOKENS,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: `mode=${mode}\n\n${text}` }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ text: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        // T-126: usage 永続化（失敗しても本体に影響しない）。
        await recordAdvisorUsage({
          endpoint: "interview-support-explain",
          model: CLAUDE_MODEL_FAST,
          usage: final.usage,
          latencyMs: Date.now() - startedAt,
          note: mode,
        });
        send({ done: true });
      } catch (e) {
        console.error("[interview-support/explain] Claude error:", e);
        send({ error: "AI の応答取得に失敗しました" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

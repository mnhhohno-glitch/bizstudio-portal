// T-205: 面談準備チャットの SSE 応答（interview-support/explain と同じ形式）。
// `data: {json}\n\n` を流し、本文は {text}、終了は {done:true,...}、失敗は {error}。

export type SseSend = (payload: Record<string, unknown>) => void;

export function sseResponse(run: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send: SseSend = (payload) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await run(send);
      } catch (e) {
        console.error("[interview-prep] stream failed:", e);
        send({ error: "AI の応答取得に失敗しました" });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
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

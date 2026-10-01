// T-XXX step3: ChatGPT の「MCP アプリ」向け入口（秘密URL方式・Streamable HTTP・ステートレス）。
//
// POST /api/mcp/<MCP_PATH_SECRET>   … JSON-RPC（initialize / tools/list / tools/call）
//   - ChatGPT の MCP アプリは認証が「OAuth」か「認証なし」しか選べないため、「認証なし＋推測できない長い秘密のURL」で接続する。
//   - 秘密は環境変数 MCP_PATH_SECRET（Railway の bizstudio-portal サービス）。照合は定数時間比較（src/lib/mcp/secret.ts）。
//     未設定・空・短すぎ・不一致はすべて 404（入口の存在を知らせない。Next の通常の 404 と同じ応答）。
//   - 回数制限は入口全体で 1 分 60 回（src/lib/mcp/rateLimit.ts）。超えたら 429。
//   - middleware（src/middleware.ts）は /api/ 配下を素通しにしているので、このパスのための除外追加は不要。
//   - ツール定義は src/lib/mcp/caKpiServer.ts。読み取り専用・DB 書き込み無し・AI 呼び出し無し。
//   - 秘密の文字列・URL はログに出さない（この入口のログはツール呼び出しの 1 行だけ。caKpiServer.ts 側で出す）。
//   - GET / DELETE は MCP の 2025 系セッション操作だが、ステートレスなので SDK が 405 を返す（ChatGPT は POST だけ使う）。
//
// URL が漏れた疑いがあるときは Railway で MCP_PATH_SECRET を作り直す（再デプロイで即座に旧URLは 404 になる）。

import { notFound } from "next/navigation";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createCaKpiMcpServer } from "@/lib/mcp/caKpiServer";
import { isValidMcpSecret } from "@/lib/mcp/secret";
import { takeMcpRateLimitToken, MCP_RATE_LIMIT } from "@/lib/mcp/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// モジュールで 1 つ。リクエストごとに factory が新しい McpServer を作る（ステートレス）。
const handler = createMcpHandler(() => createCaKpiMcpServer(), {
  legacy: "stateless",
  onerror: (e) => {
    // SDK 内のエラー・不正リクエストの報告（本文・URL は含まれない）。
    console.warn(`[mcp] handler error: ${e.message}`);
  },
});

async function handle(req: Request, ctx: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await ctx.params;
  if (!isValidMcpSecret(secret, process.env.MCP_PATH_SECRET)) notFound();

  const rl = takeMcpRateLimitToken();
  if (!rl.allowed) {
    return Response.json(
      { error: "rate_limited", message: `回数制限（${MCP_RATE_LIMIT.windowMs / 1000} 秒に ${MCP_RATE_LIMIT.maxRequests} 回）を超えました。${rl.retryAfterSec} 秒後に再試行してください` },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const res = await handler.fetch(req);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export { handle as GET, handle as POST, handle as DELETE };

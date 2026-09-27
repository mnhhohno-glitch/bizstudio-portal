// T-205 step4: 面談準備の「会社と学校の下調べ」（整理を作る直前に1回だけ呼ぶ）。
//
// - モデルは Sonnet 5。Anthropic API のサーバー側ウェブ検索ツール（web_search_20260209・動的フィルタリング付き）を使う。
//   検索回数の上限は max_uses=5。
// - 送る中身: system＝RESEARCH.md（下調べの指示本文）、user＝レジュメの文字。
// - 返ってきた JSON は research-format.ts で検証・正規化する。読めない・形が違う場合は下調べなし（null）。
// - 失敗（ウェブ検索が使えない・時間切れ・エラー）でも例外は投げず status で返す。呼び出し側は下調べなしで整理を作る。
// - 長い検索は API が pause_turn で一度返すことがあるため、応答をそのまま送り返して続けさせる（最大 MAX_CONTINUATIONS 回）。
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL_SONNET_5 } from "@/lib/claude";
import { getInterviewPrepResearchSkill } from "@/lib/load-interview-prep-skill";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { parseResearchJson, type ResearchResult } from "@/lib/interview-prep/research-format";

export const RESEARCH_MODEL = CLAUDE_MODEL_SONNET_5;
export const RESEARCH_MAX_TOKENS = 4000;
export const RESEARCH_MAX_SEARCHES = 5;
/** 1回の API 呼び出しの時間切れ（ms）。検索の二重課金を避けるため SDK の自動リトライはしない。 */
export const RESEARCH_TIMEOUT_MS = 150_000;
const MAX_CONTINUATIONS = 2;

export type ResearchStatus =
  | "ok"
  | "invalid_json" // 応答が JSON として読めない・形が違う
  | "web_search_disabled" // 組織の設定でウェブ検索が無効
  | "timeout"
  | "error";

export type ResearchUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type ResearchOutcome = {
  status: ResearchStatus;
  research: ResearchResult | null;
  usage: ResearchUsage | null;
  webSearchRequests: number;
  latencyMs: number;
  /** 失敗時の HTTP ステータスとメッセージ（完了報告・ログ用。本文は含めない）。 */
  errorStatus?: number;
  errorMessage?: string;
};

function addUsage(acc: ResearchUsage, u: Anthropic.Usage): void {
  acc.input_tokens += u.input_tokens ?? 0;
  acc.output_tokens += u.output_tokens ?? 0;
  acc.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  acc.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
}

/** 最後のツール結果より後ろの text をつなげる（検索前の「調べます」などの前置きを除く）。無ければ全 text。 */
function finalText(content: Anthropic.ContentBlock[]): string {
  let lastTool = -1;
  content.forEach((b, i) => {
    if (b.type !== "text") lastTool = i;
  });
  const tail = content.slice(lastTool + 1).filter((b): b is Anthropic.TextBlock => b.type === "text");
  const all = content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const pick = tail.length > 0 ? tail : all;
  return pick.map((b) => b.text).join("");
}

function isWebSearchDisabled(e: unknown): boolean {
  return (
    e instanceof Anthropic.BadRequestError &&
    /web[\s_-]?search/i.test(e.message) &&
    /(not enabled|disabled|not allowed)/i.test(e.message)
  );
}

export async function runResearch(resumeText: string): Promise<ResearchOutcome> {
  const startedAt = Date.now();
  const usage: ResearchUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let webSearchRequests = 0;
  let called = false;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: resumeText }];
  try {
    let response: Anthropic.Message | null = null;
    let container: string | null = null;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      response = await anthropic.messages.create(
        {
          model: RESEARCH_MODEL,
          max_tokens: RESEARCH_MAX_TOKENS,
          // Sonnet 5 は thinking 未指定だと思考が有効になる。整理と同じく無効にする（temperature は送らない）。
          thinking: { type: "disabled" },
          system: getInterviewPrepResearchSkill(),
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: RESEARCH_MAX_SEARCHES }],
          messages,
          // 動的フィルタリングは内部でコード実行を使う。続きを頼むときは同じコンテナを指定する。
          ...(container ? { container } : {}),
        },
        { timeout: RESEARCH_TIMEOUT_MS, maxRetries: 0 },
      );
      called = true;
      addUsage(usage, response.usage);
      webSearchRequests += response.usage.server_tool_use?.web_search_requests ?? 0;
      if (response.stop_reason !== "pause_turn") break;
      // pause_turn: 応答をそのまま送り返して続けさせる
      container = response.container?.id ?? null;
      messages.push({ role: "assistant", content: response.content });
    }
    const latencyMs = Date.now() - startedAt;
    const research = response ? parseResearchJson(finalText(response.content)) : null;
    return {
      status: research ? "ok" : "invalid_json",
      research,
      usage,
      webSearchRequests,
      latencyMs,
    };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const status: ResearchStatus = isWebSearchDisabled(e)
      ? "web_search_disabled"
      : e instanceof Anthropic.APIConnectionTimeoutError
        ? "timeout"
        : "error";
    return {
      status,
      research: null,
      usage: called ? usage : null,
      webSearchRequests,
      latencyMs,
      errorStatus: (e as { status?: number })?.status,
      errorMessage: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    };
  }
}

/** 下調べの使用量を AdvisorUsageLog に記録する（endpoint=interview-prep-research）。失敗しても例外は投げない。 */
export async function recordResearchUsage(
  outcome: ResearchOutcome,
  candidateId: string,
  rebuild: boolean,
): Promise<void> {
  const note = [
    rebuild ? "rebuild" : null,
    outcome.status === "ok" ? null : `research-${outcome.status}${outcome.errorStatus ? `-${outcome.errorStatus}` : ""}`,
  ]
    .filter(Boolean)
    .join("; ");
  await recordAdvisorUsage({
    endpoint: "interview-prep-research",
    model: RESEARCH_MODEL,
    usage: outcome.usage,
    candidateId,
    latencyMs: outcome.latencyMs,
    webSearchRequests: outcome.webSearchRequests,
    note: note || null,
  });
}

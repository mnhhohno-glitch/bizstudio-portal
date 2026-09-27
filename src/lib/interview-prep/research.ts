// T-205 step4: 面談準備の「会社の下調べ」（整理を作る直前に1回だけ呼ぶ）。
//
// - モデルは Sonnet 5。Anthropic API のサーバー側ウェブ検索ツールを使う。
// - step7: 学校の下調べはやめた（学校は名前を見ればCAが判断できるため）。会社用（RESEARCH_COMPANY.md）の1回だけ。
//   検索ツールは動的フィルタリング付き（web_search_20260209・ページ全体を取り込んでコードで絞る＝読み込みが大きい）から、
//   検索結果だけを返す基本版（web_search_20250305）に切り替えた。ページを取りに行くツール（web_fetch）は付けない。
//   検索上限は3回（「会社名 株式会社」で見つかればその会社は終わり、見つからない会社だけ「会社名 都道府県」）。
// - 240 秒で時間切れ。結果は research_json（companiesStatus = ok | timeout | error）にまとめる。
//   前の部屋の結果を使い回せるとき（reusableResearch）は呼ばない（呼び出し側で判定）。
// - 送る中身: system＝下調べの指示本文、user＝レジュメの文字。
// - 返ってきた JSON は research-format.ts で検証・正規化する。読めない・形が違う場合は error とする。
// - 失敗（ウェブ検索が使えない・時間切れ・エラー）でも例外は投げず status で返す。呼び出し側は止めずに整理を作る。
// - 長い検索は API が pause_turn で一度返すことがあるため、応答をそのまま送り返して続けさせる（最大 MAX_CONTINUATIONS 回）。
//   240 秒は続きの呼び出しも含めた合計（残り時間を次の呼び出しの timeout にする）。
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL_SONNET_5 } from "@/lib/claude";
import { getInterviewPrepResearchSkill } from "@/lib/load-interview-prep-skill";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import {
  parseCompanyResearchJson,
  RESEARCH_VERSION,
  type ResearchCompany,
  type ResearchPartStatus,
  type ResearchResult,
} from "@/lib/interview-prep/research-format";

export const RESEARCH_MODEL = CLAUDE_MODEL_SONNET_5;
export const RESEARCH_MAX_TOKENS = 4000;
/** 検索ツールの型。検索結果だけを返す基本版（step7）。 */
export const RESEARCH_WEB_SEARCH_TOOL = "web_search_20250305";
/** 検索回数の上限。 */
export const RESEARCH_MAX_SEARCHES = 3;
/** 時間切れ（ms・続きの呼び出しも含めた合計）。検索の二重課金を避けるため SDK の自動リトライはしない。 */
export const RESEARCH_TIMEOUT_MS = 240_000;
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
  /** まとめた結果（版番号・状態付き）。常にある。 */
  research: ResearchResult;
  /** ok のときの会社 */
  companies?: ResearchCompany[];
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

/** 呼び出しの詳しい状態を research_json に持たせる状態（ok / timeout / error）にする。 */
export function toPartStatus(status: ResearchStatus): ResearchPartStatus {
  return status === "ok" ? "ok" : status === "timeout" ? "timeout" : "error";
}

function toResearch(status: ResearchStatus, companies: ResearchCompany[]): ResearchResult {
  return { version: RESEARCH_VERSION, companiesStatus: toPartStatus(status), companies };
}

/** 会社を調べ、research_json の形にまとめる。 */
export async function runResearch(resumeText: string): Promise<ResearchOutcome> {
  const startedAt = Date.now();
  const deadline = startedAt + RESEARCH_TIMEOUT_MS;
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
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Anthropic.APIConnectionTimeoutError();
      response = await anthropic.messages.create(
        {
          model: RESEARCH_MODEL,
          max_tokens: RESEARCH_MAX_TOKENS,
          // Sonnet 5 は thinking 未指定だと思考が有効になる。整理と同じく無効にする（temperature は送らない）。
          thinking: { type: "disabled" },
          system: getInterviewPrepResearchSkill(),
          tools: [{ type: RESEARCH_WEB_SEARCH_TOOL, name: "web_search", max_uses: RESEARCH_MAX_SEARCHES }],
          messages,
        },
        { timeout: remaining, maxRetries: 0 },
      );
      called = true;
      addUsage(usage, response.usage);
      webSearchRequests += response.usage.server_tool_use?.web_search_requests ?? 0;
      if (response.stop_reason !== "pause_turn") break;
      // pause_turn: 応答をそのまま送り返して続けさせる
      messages.push({ role: "assistant", content: response.content });
    }
    const latencyMs = Date.now() - startedAt;
    const companies = parseCompanyResearchJson(response ? finalText(response.content) : "");
    const base = { usage, webSearchRequests, latencyMs };
    return companies
      ? { ...base, status: "ok", companies, research: toResearch("ok", companies) }
      : { ...base, status: "invalid_json", research: toResearch("invalid_json", []) };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const status: ResearchStatus = isWebSearchDisabled(e)
      ? "web_search_disabled"
      : e instanceof Anthropic.APIConnectionTimeoutError
        ? "timeout"
        : "error";
    return {
      status,
      research: toResearch(status, []),
      usage: called ? usage : null,
      webSearchRequests,
      latencyMs,
      errorStatus: (e as { status?: number })?.status,
      errorMessage: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    };
  }
}

/**
 * 下調べの使用量を AdvisorUsageLog に記録する（endpoint=interview-prep-research）。
 * note に part=company を入れる（step6 以前の行と見分けやすくするため残す）。失敗しても例外は投げない。
 */
export async function recordResearchUsage(
  outcome: ResearchOutcome,
  candidateId: string,
  rebuild: boolean,
): Promise<void> {
  const note = [
    "part=company",
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
    note,
  });
}

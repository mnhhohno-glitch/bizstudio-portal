// T-205 step4: 面談準備の「会社と学校の下調べ」（整理を作る直前に1回だけ呼ぶ）。
//
// - モデルは Sonnet 5。Anthropic API のサーバー側ウェブ検索ツール（web_search_20260209・動的フィルタリング付き）を使う。
// - step6: 会社用（RESEARCH_COMPANY.md・検索上限4回）と学校用（RESEARCH_SCHOOL.md・検索上限2回）の2つの呼び出しに分け、
//   同時に走らせる（片方の失敗でもう片方は止めない）。それぞれ 240 秒で時間切れ。結果は1つの research_json にまとめ、
//   部分ごとの状態（companiesStatus / schoolStatus = ok | timeout | error）を持たせる。
//   前の部屋の結果を使い回せる部分（reusableResearchParts）は呼ばない。
// - 送る中身: system＝下調べの指示本文（会社用／学校用）、user＝レジュメの文字。
// - 返ってきた JSON は research-format.ts で検証・正規化する。読めない・形が違う場合はその部分を error とする。
// - 失敗（ウェブ検索が使えない・時間切れ・エラー）でも例外は投げず status で返す。呼び出し側は止めずに整理を作る。
// - 長い検索は API が pause_turn で一度返すことがあるため、応答をそのまま送り返して続けさせる（最大 MAX_CONTINUATIONS 回）。
//   240 秒は続きの呼び出しも含めた合計（残り時間を次の呼び出しの timeout にする）。
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL_SONNET_5 } from "@/lib/claude";
import { getInterviewPrepResearchSkill } from "@/lib/load-interview-prep-skill";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import {
  parseCompanyResearchJson,
  parseSchoolResearchJson,
  RESEARCH_VERSION,
  type ResearchCompany,
  type ResearchPartStatus,
  type ResearchResult,
  type ResearchReuse,
  type ResearchSchool,
} from "@/lib/interview-prep/research-format";

export type ResearchPart = "company" | "school";

export const RESEARCH_MODEL = CLAUDE_MODEL_SONNET_5;
export const RESEARCH_MAX_TOKENS = 4000;
/** 検索回数の上限（部分ごと）。 */
export const RESEARCH_MAX_SEARCHES: Record<ResearchPart, number> = { company: 4, school: 2 };
/** 部分ごとの時間切れ（ms・続きの呼び出しも含めた合計）。検索の二重課金を避けるため SDK の自動リトライはしない。 */
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

/** 部分（会社／学校）ごとの呼び出し結果。 */
export type ResearchPartOutcome = {
  part: ResearchPart;
  status: ResearchStatus;
  /** part=company で ok のとき */
  companies?: ResearchCompany[];
  /** part=school で ok のとき（学歴なしは school=null） */
  school?: { school: ResearchSchool | null };
  usage: ResearchUsage | null;
  webSearchRequests: number;
  latencyMs: number;
  /** 失敗時の HTTP ステータスとメッセージ（完了報告・ログ用。本文は含めない）。 */
  errorStatus?: number;
  errorMessage?: string;
};

export type ResearchOutcome = {
  /** まとめた結果（版番号・部分ごとの状態付き）。常にある。 */
  research: ResearchResult;
  /** 実際に呼んだ部分の結果。使い回した部分は null。 */
  parts: Record<ResearchPart, ResearchPartOutcome | null>;
  /** 下調べ全体の待ち時間（2つの呼び出しの長い方） */
  latencyMs: number;
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

async function runResearchPart(part: ResearchPart, resumeText: string): Promise<ResearchPartOutcome> {
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
    let container: string | null = null;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Anthropic.APIConnectionTimeoutError();
      response = await anthropic.messages.create(
        {
          model: RESEARCH_MODEL,
          max_tokens: RESEARCH_MAX_TOKENS,
          // Sonnet 5 は thinking 未指定だと思考が有効になる。整理と同じく無効にする（temperature は送らない）。
          thinking: { type: "disabled" },
          system: getInterviewPrepResearchSkill(part),
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: RESEARCH_MAX_SEARCHES[part] }],
          messages,
          // 動的フィルタリングは内部でコード実行を使う。続きを頼むときは同じコンテナを指定する。
          ...(container ? { container } : {}),
        },
        { timeout: remaining, maxRetries: 0 },
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
    const text = response ? finalText(response.content) : "";
    const base = { part, usage, webSearchRequests, latencyMs };
    if (part === "company") {
      const companies = parseCompanyResearchJson(text);
      return companies ? { ...base, status: "ok", companies } : { ...base, status: "invalid_json" };
    }
    const school = parseSchoolResearchJson(text);
    return school ? { ...base, status: "ok", school } : { ...base, status: "invalid_json" };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const status: ResearchStatus = isWebSearchDisabled(e)
      ? "web_search_disabled"
      : e instanceof Anthropic.APIConnectionTimeoutError
        ? "timeout"
        : "error";
    return {
      part,
      status,
      usage: called ? usage : null,
      webSearchRequests,
      latencyMs,
      errorStatus: (e as { status?: number })?.status,
      errorMessage: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    };
  }
}

/**
 * 会社と学校を同時に調べ、1つの research_json にまとめる。reuse で使い回す部分は呼ばない。
 * onPartDone は部分ごとに終わった時点で呼ぶ（画面へ「✓ 会社を調べました」などを送るため）。
 */
export async function runResearch(
  resumeText: string,
  opts: {
    reuse?: ResearchReuse;
    onPartDone?: (part: ResearchPart, status: ResearchPartStatus) => void;
  } = {},
): Promise<ResearchOutcome> {
  const startedAt = Date.now();
  const reuse = opts.reuse;
  const run = (part: ResearchPart): Promise<ResearchPartOutcome> =>
    runResearchPart(part, resumeText).then((o) => {
      try {
        opts.onPartDone?.(part, toPartStatus(o.status));
      } catch {
        /* 画面への送信失敗で下調べは止めない */
      }
      return o;
    });
  // runResearchPart は例外を投げない（失敗は status で返す）ので、片方の失敗がもう片方を止めない
  const [company, school] = await Promise.all([
    reuse?.companies ? Promise.resolve(null) : run("company"),
    reuse?.school ? Promise.resolve(null) : run("school"),
  ]);

  const prev = reuse?.research ?? null;
  const research: ResearchResult = {
    version: RESEARCH_VERSION,
    companiesStatus: company ? toPartStatus(company.status) : "ok",
    schoolStatus: school ? toPartStatus(school.status) : "ok",
    companies: company ? (company.companies ?? []) : (prev?.companies ?? []),
    school: school ? (school.school?.school ?? null) : (prev?.school ?? null),
  };
  return { research, parts: { company, school }, latencyMs: Date.now() - startedAt };
}

/**
 * 下調べの使用量を AdvisorUsageLog に記録する（endpoint=interview-prep-research・部分ごとに1行）。
 * note に part=company / part=school を入れて区別する。失敗しても例外は投げない。
 */
export async function recordResearchUsage(
  outcome: ResearchPartOutcome,
  candidateId: string,
  rebuild: boolean,
): Promise<void> {
  const note = [
    `part=${outcome.part}`,
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

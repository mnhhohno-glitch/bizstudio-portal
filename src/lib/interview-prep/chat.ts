// T-205: 面談準備チャットの Anthropic 送信内容の組み立て（API route と検証スクリプトで共有）。
//
// 送る中身:
//   system   = ［指示本文（SKILL.md）］＋［レジュメの文字］＋［調べた情報（research_json から組み立て）］
//              … それぞれ cache_control 付き（messages 末尾と合わせてキャッシュ指定は4つまで）
//   messages = ［固定文→最初の整理］＋［直近10往復の履歴］＋［今回の質問（cache_control 付き）］
// - 最初の整理は 10往復の数え方の外に置き、常に送る。
// - 今回の質問に cache_control を付けると、次の往復で「system＋履歴」の全体が読み出し扱いになる。
// - 履歴の本文はクランプ以外の加工をしない（byte が揺れるとキャッシュが効かない・罠#39）。
// - step8: 最初の整理は文章ではなくツール save_prep_summary の入力（決まった項目）で受け取る（tool_choice で必ず呼ばせる）。
//   質問に答えるときの会話履歴には、summary_json を formatPrepSummaryText で文章にしたものを整理の AI 発言として入れる。
//   質問への回答（CA との会話）は今までどおり文章のストリーミング。
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL_SONNET_5 } from "@/lib/claude";
import { getInterviewPrepSkill } from "@/lib/load-interview-prep-skill";
import { formatResearchBlock, type ResearchResult } from "@/lib/interview-prep/research-format";
import {
  SUMMARY_TOOL_INPUT_SCHEMA,
  SUMMARY_TOOL_NAME,
  normalizePrepSummary,
  type PrepSummary,
} from "@/lib/interview-prep/summary-format";

export const INTERVIEW_PREP_MODEL = CLAUDE_MODEL_SONNET_5;
export const SUMMARY_MAX_TOKENS = 6000;
export const CHAT_MAX_TOKENS = 2000;
/** 履歴に含める直近の往復数（user+assistant で1往復）。 */
export const MAX_HISTORY_PAIRS = 10;
/** API 送信用の1メッセージ本文の上限（DB・画面表示には影響しない）。 */
export const MAX_MESSAGE_CHARS = 4000;
/** 最初の整理を頼むときの固定文。 */
export const SUMMARY_REQUEST_TEXT = "面談準備の整理を作ってください";

const RESUME_HEADER = "# マイナビレジュメの文字\n\n";

export type PrepHistoryMessage = { role: "user" | "assistant"; content: string };

type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type ApiMessage = { role: "user" | "assistant"; content: string | TextBlock[] };

function clamp(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + "\n…（長いため省略）" : text;
}

/**
 * system ブロック（指示本文＋レジュメ＋調べた情報）。いずれも byte 固定のため cache_control を付ける。
 * 調べた情報は保存済みの research_json から決定的に組み立てる（下調べなしは「なし」の1行）。
 */
export function buildPrepSystem(resumeText: string, research: ResearchResult | null): TextBlock[] {
  return [
    { type: "text", text: getInterviewPrepSkill(), cache_control: { type: "ephemeral" } },
    { type: "text", text: RESUME_HEADER + resumeText, cache_control: { type: "ephemeral" } },
    { type: "text", text: formatResearchBlock(research), cache_control: { type: "ephemeral" } },
  ];
}

/**
 * 直近10往復に切り詰める。先頭が assistant にならないよう調整し、user/assistant の交互を保つ。
 * 履歴は createdAt 昇順で渡す（最初の整理は含めない）。
 */
export function sliceHistory(history: PrepHistoryMessage[]): PrepHistoryMessage[] {
  let msgs = history.slice(-(MAX_HISTORY_PAIRS * 2));
  while (msgs.length > 0 && msgs[0].role !== "user") msgs = msgs.slice(1);
  return msgs;
}

/** 最初の整理を頼むときの messages。 */
export function buildSummaryMessages(): ApiMessage[] {
  return [{ role: "user", content: [{ type: "text", text: SUMMARY_REQUEST_TEXT, cache_control: { type: "ephemeral" } }] }];
}

/** 質問を送るときの messages。summary は最初の整理（assistant）の本文（step8 以降は formatPrepSummaryText の文章）。 */
export function buildChatMessages(summary: string, history: PrepHistoryMessage[], question: string): ApiMessage[] {
  const out: ApiMessage[] = [
    { role: "user", content: SUMMARY_REQUEST_TEXT },
    { role: "assistant", content: summary },
  ];
  for (const m of sliceHistory(history)) out.push({ role: m.role, content: clamp(m.content) });
  out.push({ role: "user", content: [{ type: "text", text: clamp(question), cache_control: { type: "ephemeral" } }] });
  return out;
}

/**
 * ストリーミングで呼び出す（質問への回答）。呼び出し側は for await で text_delta を拾い、finalMessage() で usage を取る。
 * Sonnet 5 は thinking 未指定だと思考が有効になるため明示的に無効化する（temperature は送らない）。
 */
export function createPrepStream(params: { system: TextBlock[]; messages: ApiMessage[]; maxTokens: number }) {
  return anthropic.messages.stream({
    model: INTERVIEW_PREP_MODEL,
    max_tokens: params.maxTokens,
    thinking: { type: "disabled" },
    system: params.system,
    messages: params.messages,
  });
}

/** 最初の整理を受け取るツール（step8）。項目の意味は SKILL.md に書く。 */
export const SUMMARY_TOOL: Anthropic.Tool = {
  name: SUMMARY_TOOL_NAME,
  description: "面談準備の整理を、決まった項目に分けて保存する。最初の整理はこのツールを1回呼んで返す。",
  input_schema: SUMMARY_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

export type SummaryCallResult = {
  /** 検証に通った整理。ツールが呼ばれなかった・形が違うときは null */
  summary: PrepSummary | null;
  /** 検証に通らなかった理由（ログ用） */
  invalidReason: "no_tool_use" | "invalid_shape" | null;
  usage: Anthropic.Usage;
  stopReason: Anthropic.Message["stop_reason"];
};

/**
 * 最初の整理を1回呼ぶ（ツール save_prep_summary を必ず呼ばせる）。ストリーミングで受け取り、
 * finalMessage() の tool_use 入力を検証する。onProgress は入力の文字が届くたびに呼ばれる（進み具合の送信用）。
 * 検証に通らなくても例外は投げない（呼び出し側が1回だけ作り直す）。
 */
export async function callSummaryTool(params: {
  system: TextBlock[];
  messages: ApiMessage[];
  onProgress?: () => void;
}): Promise<SummaryCallResult> {
  const stream = anthropic.messages.stream({
    model: INTERVIEW_PREP_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    thinking: { type: "disabled" },
    system: params.system,
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: SUMMARY_TOOL_NAME },
    messages: params.messages,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") params.onProgress?.();
  }
  const final = await stream.finalMessage();
  const toolUse = final.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUMMARY_TOOL_NAME,
  );
  if (!toolUse) return { summary: null, invalidReason: "no_tool_use", usage: final.usage, stopReason: final.stop_reason };
  const summary = normalizePrepSummary(toolUse.input);
  return {
    summary,
    invalidReason: summary ? null : "invalid_shape",
    usage: final.usage,
    stopReason: final.stop_reason,
  };
}

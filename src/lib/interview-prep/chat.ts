// T-205: 面談準備チャットの Anthropic 送信内容の組み立て（API route と検証スクリプトで共有）。
//
// 送る中身:
//   system   = ［指示本文（SKILL.md）］＋［レジュメの文字］ … それぞれ cache_control 付き
//   messages = ［固定文→最初の整理］＋［直近10往復の履歴］＋［今回の質問（cache_control 付き）］
// - 最初の整理は 10往復の数え方の外に置き、常に送る。
// - 今回の質問に cache_control を付けると、次の往復で「system＋履歴」の全体が読み出し扱いになる。
// - 履歴の本文はクランプ以外の加工をしない（byte が揺れるとキャッシュが効かない・罠#39）。
import { anthropic, CLAUDE_MODEL_SONNET_5 } from "@/lib/claude";
import { getInterviewPrepSkill } from "@/lib/load-interview-prep-skill";

export const INTERVIEW_PREP_MODEL = CLAUDE_MODEL_SONNET_5;
export const SUMMARY_MAX_TOKENS = 4000;
export const CHAT_MAX_TOKENS = 2000;
/** 履歴に含める直近の往復数（user+assistant で1往復）。 */
export const MAX_HISTORY_PAIRS = 10;
/** API 送信用の1メッセージ本文の上限（DB・画面表示には影響しない）。 */
export const MAX_MESSAGE_CHARS = 4000;
/** 最初の整理を頼むときの固定文。 */
export const SUMMARY_REQUEST_TEXT = "面談準備の整理を作ってください";
/** 部屋に保存する経歴の型。整理本文から取り出す。 */
export const CAREER_TYPES = ["一社継続型", "同職種転職型", "職種転換型"] as const;
export type CareerType = (typeof CAREER_TYPES)[number];

const RESUME_HEADER = "# マイナビレジュメの文字\n\n";

export type PrepHistoryMessage = { role: "user" | "assistant"; content: string };

type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type ApiMessage = { role: "user" | "assistant"; content: string | TextBlock[] };

/** 最初の整理から経歴の型を取り出す。取れなければ null。 */
export function extractCareerType(summary: string): CareerType | null {
  const m = summary.match(/経歴の型[:：]\s*(一社継続型|同職種転職型|職種転換型)/);
  return m ? (m[1] as CareerType) : null;
}

function clamp(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + "\n…（長いため省略）" : text;
}

/** system ブロック（指示本文＋レジュメ）。どちらも byte 固定のため cache_control を付ける。 */
export function buildPrepSystem(resumeText: string): TextBlock[] {
  return [
    { type: "text", text: getInterviewPrepSkill(), cache_control: { type: "ephemeral" } },
    { type: "text", text: RESUME_HEADER + resumeText, cache_control: { type: "ephemeral" } },
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

/** 質問を送るときの messages。summary は最初の整理（assistant）の本文。 */
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
 * ストリーミングで呼び出す。呼び出し側は for await で text_delta を拾い、finalMessage() で usage を取る。
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

/** 整理の3見出しがそろっているか（検証スクリプト用）。 */
export function hasSummaryHeadings(text: string): boolean {
  return /1\.\s*本人の事実/.test(text) && /2\.\s*職種の解説/.test(text) && /3\.\s*面談で聞く質問/.test(text);
}

// T-183 Phase 3: 面談サポートの自動検知API。
// 発話確定ごとにクライアントが「前回スキャン以降の新規確定発話」を送り、3種のカード
// （用語 terms / 業務内容 jobs / 転職理由 reason）を JSON で返す。該当なしは空配列/null（沈黙が正解）。
// - CLAUDE_MODEL_FAST（Haiku）・拡張思考なし・非ストリーミング（自動表示は1〜2秒の遅延が許容されるため）。
// - system は「固定指示」＋「事前情報」（Phase 5）の2ブロック構成で、両方に cache_control。
//   固定指示は全面談で共通、事前情報は同一面談中は byte 一致なので、どちらもキャッシュに乗る。
//   可変データ（新規発話・既存カード）はすべて user 側。
// - JSONパース失敗時は空結果を返す（画面にエラーを出さない。次回スキャンで回復）。
// - usage は T-126 の流儀で AdvisorUsageLog に記録する。
// Phase 5 追加:
// - priorInfoText（キャリアシート等の抽出テキスト。prior-info API 由来）を任意で受ける。
// - text 空＋priorInfoText あり＝「開始」時の下書きモード（事前情報のみから jobs/reason を生成）。
// - jobs/reason に questions（新人CA向けの深掘り質問1〜3件）と source（"prior"|"conversation"）を追加。

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { anthropic, CLAUDE_MODEL_FAST } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

// 出力上限トークン。Phase 5 で questions（各カード1〜3件）が乗るため 600→900 に増額。実測で調整する。
const AUTO_SCAN_MAX_TOKENS = 900;
// 新規発話の受け付け上限（暴走送信・コスト事故の防止）。超過分は古い側を切り捨てる（自動フローはエラーにしない）。
const MAX_TEXT_CHARS = 4000;
// 事前情報の受け付け上限。prior-info API 側でも同値で切り詰めるが、二重の防波堤として持つ。
const MAX_PRIOR_INFO_CHARS = 6000;
// 解説済み用語・既存カードの受け付け上限（プロンプト肥大の防止）。
const MAX_EXPLAINED_TERMS = 30;
const MAX_EXISTING_JOBS = 10;
const MAX_CARD_TEXT_CHARS = 2000;
// questions は1カード最大3件・各200字まで。
const MAX_QUESTIONS = 3;
const MAX_QUESTION_CHARS = 200;

// 下書きモードで user 側の「新規発話」に入れる目印。SYSTEM_PROMPT の記述と一致させること。
const BOOTSTRAP_TEXT_MARKER = "(面談開始前)";

// 固定 system プロンプト。byte 一致でプロンプトキャッシュに乗せるため、動的要素は一切入れない。
const SYSTEM_PROMPT = `あなたは人材紹介会社のキャリアアドバイザー(CA)を支援するアシスタントです。
入力は、CAと求職者の面談のリアルタイム文字起こしの断片（新規発話）と、作成済みカードの現在の内容です。話者は混在し、誤字・認識ミスを含みます。文脈から補って読んでください。
このメッセージの後に「事前情報」（求職者のキャリアシート・職務経歴書等の抜粋）が付く場合があります。

次のJSONのみを出力してください。前後に説明文・コードブロック記号を付けないこと。
{"terms":[{"term":"用語","text":"解説"}],"jobs":[{"key":"職務の識別子","title":"見出し","text":"要約","questions":["質問文"],"source":"prior"}],"reason":{"text":"転職理由の整理","questions":["質問文"],"source":"conversation"}}

共通ルール:
- 検知対象は「業界用語・職種用語」「求職者の業務内容」「転職理由」の3つのみ。希望条件・日程調整・雑談・その他は無視し、該当フィールドを空配列/nullにする。
- 判定に迷ったら出さない（沈黙が正解）。
- text は答えそのものから始める。「〇〇とは、」等の前置き・まとめ・免責は禁止。
- 確証が持てない内容には「(推測)」と添える。

事前情報の扱い（事前情報がある場合のみ）:
- 事前情報は参考。会話の内容を常に優先する。
- 事前情報と会話が食い違う場合は会話を採用し、食い違い自体を questions に入れる（例:「シートでは年収500万とありますが、現在もそうですか？」）。
- source: カードの根拠が事前情報のみなら "prior"、本人が会話で語った内容を含むなら "conversation"。existingJobs の source が "prior" の職務について本人が語ったら、同じ key で更新して "conversation" に切り替える。事前情報が無い場合は常に "conversation"。
- 文字起こしの誤字・断片は、事前情報にある職種名・社名・資格名を手がかりに補正して読む。
- 新規発話が「(面談開始前)」の場合は下書きモード: 事前情報のみから jobs（会社/職務ごとの要約＋questions、source="prior"）を作る。reason は事前情報に転職理由の記載がある場合のみ作る（記載がなければ null）。terms は出さない。

terms: 業務の中で出る専門用語・業界特有の言い回し・略語のうち、業界知識ゼロの新人CAが理解できない可能性が高いもののみ、最大2件。次のものは terms に入れない: explainedTerms にある用語 / 一般的な言葉 / 職種名・国家資格名（理学療法士・看護師・施工管理など。これらは jobs で扱う）/ 同じ応答の jobs や existingJobs の title・key に含まれる語。文の途中で切れた語・単独で現れた1語・文脈と噛み合わない語は、文字起こしの断片とみなして terms にしない。各解説は結論1行+補足最大2行、80〜120字。

jobs: 求職者が自分の業務内容を説明している時（および下書きモード）のみ。要約は本人の発言（および事前情報）に基づく「この人が実際に何をしていたか」を書く（担当業務・対象・規模・道具や手法・役割。3〜5行）。職種名しか分かっていない段階では1〜2行にとどめ、末尾に「（本人の具体的な業務はまだ未聴取）」と付ける。具体が出たら更新して注記を外す。「強み: 〇〇」の1行は本人の話または事前情報に根拠がある時だけ添える。existingJobs と同じ職務の話なら同じ key を使い、新情報を統合した全文の更新版を返す。別の会社・別の職務なら新しい key で返す。title は「前職: 設備保全」のような短い見出し。業務説明がなければ空配列。

reason: 転職理由が語られた時（および下書きモードで事前情報に記載がある時）のみ。要点を「・」区切りで最大4行に整理する。existingReason がある場合は新情報を統合した全文の更新版を返す。語られていなければ null。

questions（jobs・reason 共通）: 新人CAがそのまま読み上げられる質問文を1〜3件（例:「急性期と回復期、どちらの経験が長いですか？」「17時までというのは絶対条件ですか？」）。求人提案・推薦に効く確認事項を優先する（経験の深さ・規模・制約条件・事前情報の空白や曖昧な点・事前情報と会話の食い違い）。既存カードの questions のうち本人が既に答えたものは外し、新しい確認ポイントに入れ替える。`;

type RequestBody = {
  text?: string;
  priorInfoText?: string;
  explainedTerms?: unknown;
  existingJobs?: unknown;
  existingReason?: unknown;
};

export type AutoScanTerm = { term: string; text: string };
export type AutoScanCardSource = "prior" | "conversation";
export type AutoScanJob = {
  key: string;
  title: string;
  text: string;
  questions: string[];
  source: AutoScanCardSource;
};
export type AutoScanResult = {
  terms: AutoScanTerm[];
  jobs: AutoScanJob[];
  reason: { text: string; questions: string[]; source: AutoScanCardSource } | null;
};

const EMPTY_RESULT: AutoScanResult = { terms: [], jobs: [], reason: null };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asQuestions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((q): q is string => typeof q === "string" && q.trim() !== "")
    .slice(0, MAX_QUESTIONS)
    .map((q) => q.trim().slice(0, MAX_QUESTION_CHARS));
}

function asSource(v: unknown, fallback: AutoScanCardSource): AutoScanCardSource {
  return v === "prior" || v === "conversation" ? v : fallback;
}

/** モデル出力から JSON を取り出して検証する。壊れていたら null（呼び出し側で空結果扱い）。 */
function parseAutoScanResult(raw: string, defaultSource: AutoScanCardSource): AutoScanResult | null {
  // 指示に反してコードブロック等が付いた場合に備え、最初の { から最後の } までを対象にする。
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as { terms?: unknown; jobs?: unknown; reason?: unknown };

  const terms: AutoScanTerm[] = [];
  if (Array.isArray(obj.terms)) {
    for (const t of obj.terms.slice(0, 2)) {
      const term = asString((t as { term?: unknown })?.term);
      const text = asString((t as { text?: unknown })?.text);
      if (term && text) terms.push({ term, text });
    }
  }

  const jobs: AutoScanJob[] = [];
  if (Array.isArray(obj.jobs)) {
    for (const j of obj.jobs.slice(0, MAX_EXISTING_JOBS)) {
      const key = asString((j as { key?: unknown })?.key);
      const title = asString((j as { title?: unknown })?.title);
      const text = asString((j as { text?: unknown })?.text);
      if (key && text) {
        jobs.push({
          key,
          title: title ?? "業務内容",
          text,
          questions: asQuestions((j as { questions?: unknown })?.questions),
          source: asSource((j as { source?: unknown })?.source, defaultSource),
        });
      }
    }
  }

  const reasonObj = obj.reason as { text?: unknown; questions?: unknown; source?: unknown } | null | undefined;
  const reasonText = asString(reasonObj?.text);
  return {
    terms,
    jobs,
    reason: reasonText
      ? {
          text: reasonText,
          questions: asQuestions(reasonObj?.questions),
          source: asSource(reasonObj?.source, defaultSource),
        }
      : null,
  };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const body = (await req.json()) as RequestBody;
  const rawText = (body.text ?? "").trim();
  const priorInfoText = (body.priorInfoText ?? "").trim().slice(0, MAX_PRIOR_INFO_CHARS);
  // Phase 5: text 空＋事前情報あり＝「開始」時の下書きモード。どちらも無ければ従来どおり 400。
  const bootstrap = !rawText && !!priorInfoText;
  if (!rawText && !priorInfoText) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const text = rawText.length > MAX_TEXT_CHARS ? rawText.slice(-MAX_TEXT_CHARS) : rawText;

  const explainedTerms = (Array.isArray(body.explainedTerms) ? body.explainedTerms : [])
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .slice(-MAX_EXPLAINED_TERMS);
  const existingJobs = (Array.isArray(body.existingJobs) ? body.existingJobs : [])
    .map((j) => ({
      key: asString((j as { key?: unknown })?.key),
      title: asString((j as { title?: unknown })?.title),
      text: asString((j as { text?: unknown })?.text)?.slice(0, MAX_CARD_TEXT_CHARS),
      questions: asQuestions((j as { questions?: unknown })?.questions),
      source: asSource((j as { source?: unknown })?.source, "conversation"),
    }))
    .filter((j): j is { key: string; title: string | null; text: string; questions: string[]; source: AutoScanCardSource } => !!j.key && !!j.text)
    .slice(0, MAX_EXISTING_JOBS);
  // Phase 5: existingReason は { text, questions } オブジェクト（旧形式の string も受ける）。
  const rawReason = body.existingReason;
  const existingReason =
    typeof rawReason === "string"
      ? asString(rawReason)
        ? { text: asString(rawReason)!.slice(0, MAX_CARD_TEXT_CHARS), questions: [] as string[] }
        : null
      : asString((rawReason as { text?: unknown } | null | undefined)?.text)
        ? {
            text: asString((rawReason as { text?: unknown }).text)!.slice(0, MAX_CARD_TEXT_CHARS),
            questions: asQuestions((rawReason as { questions?: unknown }).questions),
          }
        : null;

  const userMessage = [
    `新規発話:\n${bootstrap ? BOOTSTRAP_TEXT_MARKER : text}`,
    `explainedTerms: ${explainedTerms.length > 0 ? explainedTerms.join("、") : "(なし)"}`,
    `existingJobs: ${existingJobs.length > 0 ? JSON.stringify(existingJobs) : "(なし)"}`,
    `existingReason: ${existingReason ? JSON.stringify(existingReason) : "(なし)"}`,
  ].join("\n\n");

  // system は「固定指示」→「事前情報」の順で cache_control を付ける（prefix 一致キャッシュ）。
  // 事前情報は同一面談中クライアントが同じ文字列を送り続けるため byte 一致でキャッシュに乗る。
  const system: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (priorInfoText) {
    system.push({
      type: "text",
      text: `事前情報（求職者のキャリアシート等の抜粋。参考情報であり、会話の内容を優先すること）:\n${priorInfoText}`,
      cache_control: { type: "ephemeral" },
    });
  }

  const startedAt = Date.now();
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL_FAST,
      max_tokens: AUTO_SCAN_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const result = parseAutoScanResult(raw, bootstrap ? "prior" : "conversation") ?? EMPTY_RESULT;
    // 下書きモードで terms が出ても採用しない（指示違反の保険）。
    if (bootstrap) result.terms = [];

    // T-126: usage 永続化（失敗しても本体に影響しない）。
    await recordAdvisorUsage({
      endpoint: "interview-support-auto-scan",
      model: CLAUDE_MODEL_FAST,
      usage: message.usage,
      latencyMs: Date.now() - startedAt,
      note: `terms:${result.terms.length} jobs:${result.jobs.length} reason:${result.reason ? 1 : 0}${bootstrap ? " bootstrap" : ""}${priorInfoText ? " prior" : ""}`,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[interview-support/auto-scan] Claude error:", e);
    return NextResponse.json({ error: "AI の応答取得に失敗しました" }, { status: 502 });
  }
}

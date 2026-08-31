// T-183 Phase 3: 面談サポートの自動検知API。
// 30秒ごとにクライアントが「前回スキャン以降の新規確定発話」を送り、3種のカード
// （用語 terms / 業務内容 jobs / 転職理由 reason）を JSON で返す。該当なしは空配列/null（沈黙が正解）。
// - CLAUDE_MODEL_FAST（Haiku）・拡張思考なし・非ストリーミング（自動表示は1〜2秒の遅延が許容されるため）。
// - system は完全固定で cache_control（byte一致でプロンプトキャッシュに乗せる）。可変データはすべて user 側。
// - JSONパース失敗時は空結果を返す（画面にエラーを出さない。次回スキャンで回復）。
// - usage は T-126 の流儀で AdvisorUsageLog に記録する。

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { anthropic, CLAUDE_MODEL_FAST } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

// 出力上限トークン。②③の更新文（全文置き換え）があるため explain(250) より大きめの初期値。実測で調整する。
const AUTO_SCAN_MAX_TOKENS = 600;
// 新規発話の受け付け上限（暴走送信・コスト事故の防止）。超過分は古い側を切り捨てる（自動フローはエラーにしない）。
const MAX_TEXT_CHARS = 4000;
// 解説済み用語・既存カードの受け付け上限（プロンプト肥大の防止）。
const MAX_EXPLAINED_TERMS = 30;
const MAX_EXISTING_JOBS = 10;
const MAX_CARD_TEXT_CHARS = 2000;

// 固定 system プロンプト。byte 一致でプロンプトキャッシュに乗せるため、動的要素は一切入れない。
const SYSTEM_PROMPT = `あなたは人材紹介会社のキャリアアドバイザー(CA)を支援するアシスタントです。
入力は、CAと求職者の面談のリアルタイム文字起こしの断片（新規発話）と、作成済みカードの現在の内容です。話者は混在し、誤字・認識ミスを含みます。文脈から補って読んでください。

次のJSONのみを出力してください。前後に説明文・コードブロック記号を付けないこと。
{"terms":[{"term":"用語","text":"解説"}],"jobs":[{"key":"職務の識別子","title":"見出し","text":"要約"}],"reason":{"text":"転職理由の整理"}}

共通ルール:
- 検知対象は「業界用語・職種用語」「求職者の業務内容」「転職理由」の3つのみ。希望条件・日程調整・雑談・その他は無視し、該当フィールドを空配列/nullにする。
- 判定に迷ったら出さない（沈黙が正解）。
- text は答えそのものから始める。「〇〇とは、」等の前置き・まとめ・免責は禁止。
- 確証が持てない内容には「(推測)」と添える。

terms: 業界知識ゼロの新人CAが理解できない可能性が高い用語のみ、最大2件。explainedTerms にある用語と一般的な言葉は除外。各解説は結論1行+補足最大2行、80〜120字。

jobs: 求職者が自分の業務内容を説明している時のみ。知識ゼロの人が「この人は何をしている人か」を理解できる要約(3〜5行)を書き、経歴から見える強み・得意が分かる範囲であれば末尾に「強み: 〇〇」を1行添える。existingJobs と同じ職務の話なら同じ key を使い、新情報を統合した全文の更新版を返す。別の会社・別の職務なら新しい key で返す。title は「前職: 設備保全」のような短い見出し。業務説明がなければ空配列。

reason: 転職理由が語られた時のみ。要点を「・」区切りで最大4行に整理する。existingReason がある場合は新情報を統合した全文の更新版を返す。語られていなければ null。`;

type RequestBody = {
  text?: string;
  explainedTerms?: unknown;
  existingJobs?: unknown;
  existingReason?: unknown;
};

export type AutoScanTerm = { term: string; text: string };
export type AutoScanJob = { key: string; title: string; text: string };
export type AutoScanResult = {
  terms: AutoScanTerm[];
  jobs: AutoScanJob[];
  reason: { text: string } | null;
};

const EMPTY_RESULT: AutoScanResult = { terms: [], jobs: [], reason: null };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** モデル出力から JSON を取り出して検証する。壊れていたら null（呼び出し側で空結果扱い）。 */
function parseAutoScanResult(raw: string): AutoScanResult | null {
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
      if (key && text) jobs.push({ key, title: title ?? "業務内容", text });
    }
  }

  const reasonText = asString((obj.reason as { text?: unknown } | null | undefined)?.text);
  return { terms, jobs, reason: reasonText ? { text: reasonText } : null };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const body = (await req.json()) as RequestBody;
  const rawText = (body.text ?? "").trim();
  if (!rawText) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const text = rawText.length > MAX_TEXT_CHARS ? rawText.slice(-MAX_TEXT_CHARS) : rawText;

  const explainedTerms = (Array.isArray(body.explainedTerms) ? body.explainedTerms : [])
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .slice(-MAX_EXPLAINED_TERMS);
  const existingJobs = (Array.isArray(body.existingJobs) ? body.existingJobs : [])
    .map((j) => ({
      key: asString((j as { key?: unknown })?.key),
      title: asString((j as { title?: unknown })?.title),
      text: asString((j as { text?: unknown })?.text)?.slice(0, MAX_CARD_TEXT_CHARS),
    }))
    .filter((j): j is { key: string; title: string | null; text: string } => !!j.key && !!j.text)
    .slice(0, MAX_EXISTING_JOBS);
  const existingReason = asString(body.existingReason)?.slice(0, MAX_CARD_TEXT_CHARS) ?? null;

  const userMessage = [
    `新規発話:\n${text}`,
    `explainedTerms: ${explainedTerms.length > 0 ? explainedTerms.join("、") : "(なし)"}`,
    `existingJobs: ${existingJobs.length > 0 ? JSON.stringify(existingJobs) : "(なし)"}`,
    `existingReason: ${existingReason ?? "(なし)"}`,
  ].join("\n\n");

  const startedAt = Date.now();
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL_FAST,
      max_tokens: AUTO_SCAN_MAX_TOKENS,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const result = parseAutoScanResult(raw) ?? EMPTY_RESULT;

    // T-126: usage 永続化（失敗しても本体に影響しない）。
    await recordAdvisorUsage({
      endpoint: "interview-support-auto-scan",
      model: CLAUDE_MODEL_FAST,
      usage: message.usage,
      latencyMs: Date.now() - startedAt,
      note: `terms:${result.terms.length} jobs:${result.jobs.length} reason:${result.reason ? 1 : 0}`,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[interview-support/auto-scan] Claude error:", e);
    return NextResponse.json({ error: "AI の応答取得に失敗しました" }, { status: 502 });
  }
}

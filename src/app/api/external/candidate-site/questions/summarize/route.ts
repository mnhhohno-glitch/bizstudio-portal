import { NextResponse } from "next/server";
import { verifyCandidateSiteKey } from "@/lib/candidate-site-auth";
import { anthropic, CLAUDE_MODEL_LIGHT } from "@/lib/claude";

// T-128 batch4: 求職者サイト「担当CAに質問する」の要約プレビュー。
// POST /api/external/candidate-site/questions/summarize
//
// - 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（401）。既存4エンドポイントと同一テンプレ。
// - 入力: { question }（最大1000文字・超過は400）。純粋なテキスト変換のため候補者スコープは取らない（DBアクセスなし）。
// - 要約: CLAUDE_MODEL_LIGHT（Haiku）で 1〜2文の敬体に要約。固有名詞・希望条件・数値は保持・新情報の追加禁止。
// - フォールバック: AI呼び出し失敗時は原文をそのまま summary として返す（サービス継続）。失敗はログに残す。
// - レスポンス: { summary }

const MAX_LEN = 1000;

const SYSTEM_PROMPT =
  "あなたはキャリアアドバイザー(CA)向けに、求職者からの質問を簡潔に要約するアシスタントです。" +
  "質問の意図を保ったまま、1〜2文の敬体で要約してください。" +
  "会社名・求人名・固有名詞・希望条件・数値はそのまま保持し、新しい情報を足したり推測で補完したりしないこと。" +
  "要約文のみを出力し、前置き・引用符・箇条書き・見出しは付けないこと。";

export async function POST(request: Request) {
  if (!verifyCandidateSiteKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > MAX_LEN) {
    return NextResponse.json({ error: `question must be <= ${MAX_LEN} characters` }, { status: 400 });
  }

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIGHT,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    // 空応答時も原文フォールバック。
    return NextResponse.json({ summary: text || question });
  } catch (e) {
    console.error("[candidate-site/questions/summarize] AI要約失敗（原文フォールバック）:", e);
    return NextResponse.json({ summary: question });
  }
}

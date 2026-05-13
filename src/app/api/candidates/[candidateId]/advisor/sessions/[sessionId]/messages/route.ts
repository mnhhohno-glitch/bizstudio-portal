import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  parsePdfWithAI,
  parseImageWithAI,
  parseDocWithAI,
  parseTextFile,
} from "@/lib/file-parser";
import { getJobMatchingSkill } from "@/lib/load-job-matching-skill";

const ADVISOR_PERSONA_PROMPT = `# Role & Persona

あなたは人材紹介会社「株式会社ビズスタジオ」のシニアキャリアアドバイザーです。
担当CAと一緒に、以下の求職者の転職支援を行います。

## 回答スタイル
- CAとの自然な会話を意識する。毎回長文レポートを書かない
- 質問の深さに応じて回答の長さを調整する：
  - 簡単な確認や短い質問 → 1〜3文で簡潔に答える
  - 具体的な相談や分析依頼 → 必要な分だけ詳しく答える（それでも要点を絞る）
  - 複雑な戦略相談 → 構造化して丁寧に答える
- 聞かれていないことまで先回りして書かない
- 「何か他にありますか？」等の定型的な締めは不要

## 読みやすいフォーマット
- 話題が変わるときは必ず空行を入れて段落を分ける
- 3社以上の比較や複数ポイントの説明は、見出し（■や【】）や箇条書きで整理する
- 1つの段落は3〜4文まで。長くなりそうなら段落を分割する
- 結論やおすすめ順位は最初か最後にまとめて、パッと見で分かるようにする
- ただし短い回答のときは無理にフォーマットしない。1〜2文なら装飾不要

## 行動指針
- CAの質問や相談に対して、以下のスキル定義と求職者データに基づいてアドバイスする
- 求職者の強み・課題を客観的に分析する
- 求人の提案時は、転職軸との一致度を説明する
- 日本語で回答する

## 求職者分析時の出力ルール

タイプ診断やWill-Can-Must分析を行った場合、分析結果だけで終わらず、必ず以下の「CA向け検索戦略アドバイス」をセットで出力すること。CAが今すぐ求人検索に動けるレベルの具体的な提案を行うこと。

### 生活面の絶対制約条件（最優先チェック）

面談ログ・求職者情報に生活面の時間的制約（保育園/学童のお迎え、介護、通院、時短、通勤上限など）がある場合、これを検索戦略の最上位に置くこと。タイプ診断や年収条件よりも優先度が高い。

制約がある場合は、検索戦略の冒頭に以下の形式で明記すること:

■ ⚠️ 絶対制約条件
- （例）お迎え18時 → 退社17時必須
- この条件を満たさない求人は全て対象外
- 在宅勤務可の求人であればエリア制約が緩和される

### 分析依頼時に必ず出力する項目

■ 検索条件（推奨）
- 職種キーワード／業種（S→A→Bの優先度付き）／年収レンジ（理想と許容下限）／エリア／フリーワード／休日・残業条件

■ 避けるべき求人の特徴
- この求職者に合わない求人の具体的な特徴を列挙

■ 提案時の注意点
- 応募を躊躇しそうなポイント／エントリー率を上げるための先回り説明／書類通過率の見込みと工夫

■ 書類作成のポイント
- 職務経歴書でどこを強調すべきか／企業に刺さるアピールポイント

### 出力しない場合

雑談や簡単な確認質問など、分析を求められていない場合はこのフォーマットを使わない。「タイプ診断して」「分析して」「検索戦略を教えて」等の明確な依頼があった場合のみ上記フォーマットで出力する。

---

# 求人マッチングスキル定義

以下のスキル定義に基づいて求職者分析・求人マッチングを行うこと。

`;

const CANDIDATE_DATA_HEADER = `

---

# 求職者データ

`;

const CACHE_TTL = 30 * 60 * 1000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_PAST_MESSAGES = 20;
const MAX_TEXT_FILE_CHARS = 8000;
const API_TIMEOUT_MS = 120000; // 2分

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OPUS_KEYWORDS = [
  /タイプ診断/, /志向性/, /6タイプ/,
  /Will[\s-]*Can[\s-]*Must/i, /ABCD/i, /マトリックス/,
  /検索戦略/, /検索条件/, /分析して/, /診断して/,
  /マッチング/, /適性評価/,
  /求人.{0,10}評価/, /求人.{0,10}分析/,
];

// スキルプロンプト（フルスキル版）が必要な場合のキーワード
const SKILL_KEYWORDS = [
  /タイプ診断/, /志向性/, /6タイプ/,
  /検索戦略/, /検索軸/, /求人.{0,10}検索/,
  /マッチング/, /マッチ度/, /ABCD/,
  /Will[\s-]*Can[\s-]*Must/i,
  /逆転質問/,
  /求人.{0,10}分析/, /求人.{0,10}評価/,
  /フレームワーク/,
  /タイプ.{0,5}更新/, /評価.{0,5}アップデート/,
];

function needsSkillPrompt(message: string, hasFile: boolean): boolean {
  if (hasFile) return true;
  return SKILL_KEYWORDS.some((p) => p.test(message));
}

const LIGHT_SYSTEM_PROMPT = `あなたはビズスタジオのキャリアアドバイザーAIアシスタントです。
転職エージェントとして求職者の支援を行っています。

以下の情報を踏まえてアドバイスしてください:
- 求職者の経歴、希望条件、面談内容に基づいた具体的なアドバイス
- 面接対策、書類添削、年収交渉などの転職支援全般
- 業界・職種の知識を活かした的確な回答

タイプ診断、検索戦略の策定、求人のマッチング評価など、専門的なフレームワークが必要な場合は「タイプ診断して」「検索戦略を考えて」等と指示してください。

回答は簡潔に、求職者名を使って親しみやすく対応してください。

`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function selectModel(message: string, hasFile: boolean): string {
  // コスト検証中: 一旦全てSonnetで運用
  // 品質に問題があれば以下のコメントを外してOpus振り分けを復活
  /*
  if (hasFile) {
    console.log("[Advisor] Model: Opus (file attached)");
    return "claude-opus-4-6";
  }
  if (OPUS_KEYWORDS.some((p) => p.test(message))) {
    console.log("[Advisor] Model: Opus (keyword match)");
    return "claude-opus-4-6";
  }
  */
  console.log("[Advisor] Model: Sonnet (all-sonnet mode)");
  return "claude-sonnet-4-6";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;

  const messages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, sessionId } = await params;
  const { content, file } = await req.json();

  console.log("=== Advisor Message API ===");
  console.log("Content:", content?.substring(0, 100));
  console.log("File received:", file ? { name: file.name, mimeType: file.mimeType, base64Length: file.base64?.length } : "none");

  if (!content?.trim() && !file) {
    return NextResponse.json({ error: "メッセージまたはファイルが必要です" }, { status: 400 });
  }

  // 添付ファイル解析
  let fileContext = "";
  if (file?.base64) {
    try {
      const mt = file.mimeType || "";
      if (mt === "application/pdf") {
        fileContext = await parsePdfWithAI(file.base64);
      } else if (mt.startsWith("image/")) {
        fileContext = await parseImageWithAI(file.base64, mt);
      } else if (mt === "text/plain" || mt === "text/csv") {
        const fullText = parseTextFile(file.base64);
        fileContext = fullText.length > MAX_TEXT_FILE_CHARS
          ? fullText.substring(0, MAX_TEXT_FILE_CHARS) + `\n\n...（以下省略、全${fullText.length}文字）`
          : fullText;
      } else if (mt.includes("word") || mt.includes("document") || mt.includes("excel") || mt.includes("spreadsheet") || mt.includes("powerpoint") || mt.includes("presentation")) {
        fileContext = await parseDocWithAI(file.base64, mt);
      }
    } catch (e) {
      console.error("File parse error:", e);
      fileContext = "（ファイルの読み取りに失敗しました）";
    }
  }

  // メッセージ本文を組み立て
  let fullContent = (content || "").trim();
  if (fileContext) {
    const fileName = file?.name || "添付ファイル";
    if (fullContent) {
      fullContent = `${fullContent}\n\n---\n添付ファイル「${fileName}」の内容:\n${fileContext}`;
    } else {
      fullContent = `添付ファイル「${fileName}」の内容:\n${fileContext}`;
    }
  }

  if (!fullContent) {
    return NextResponse.json({ error: "メッセージが空です" }, { status: 400 });
  }

  // ユーザーメッセージ保存
  await prisma.advisorChatMessage.create({
    data: { sessionId, role: "user", content: fullContent },
  });

  // 過去メッセージ取得（直近20件に制限）
  const allMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  const pastMessages = allMessages.slice(-MAX_PAST_MESSAGES);

  // セッションタイトル自動更新（初回メッセージ時）
  const displayTitle = (content || file?.name || "").trim();
  if (allMessages.length === 1 && displayTitle) {
    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { title: displayTitle.substring(0, 30) + (displayTitle.length > 30 ? "..." : "") },
    });
  }

  // コンテキスト取得（キャッシュ対応）
  const session = await prisma.advisorChatSession.findUnique({
    where: { id: sessionId },
    select: { contextCache: true, contextCachedAt: true },
  });

  let context = session?.contextCache || "";
  const cacheExpired = !session?.contextCachedAt ||
    Date.now() - new Date(session.contextCachedAt).getTime() > CACHE_TTL;

  if (!context || cacheExpired) {
    try {
      const baseUrl = process.env.PORTAL_BASE_URL || (req.headers.get("origin") ?? "");
      const contextRes = await fetch(`${baseUrl}/api/candidates/${candidateId}/advisor/context`, {
        headers: { cookie: req.headers.get("cookie") || "" },
      });
      if (contextRes.ok) {
        const contextData = await contextRes.json();
        context = contextData.context || "";
        await prisma.advisorChatSession.update({
          where: { id: sessionId },
          data: { contextCache: context, contextCachedAt: new Date() },
        });
      }
    } catch (e) {
      console.error("Context fetch error:", e);
    }
  }

  // コンテキストが長すぎる場合は切り詰め
  if (context && context.length > MAX_CONTEXT_CHARS) {
    context = context.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
  }

  // Anthropic API呼び出し
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const useSkill = needsSkillPrompt(content || "", !!file);
  console.log(`[Advisor] Skill mode: ${useSkill ? "FULL" : "LIGHT"}`);
  const systemPromptText = useSkill
    ? ADVISOR_PERSONA_PROMPT + getJobMatchingSkill() + CANDIDATE_DATA_HEADER + context
    : LIGHT_SYSTEM_PROMPT + context;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: selectModel(content || "", !!file),
        max_tokens: 4000,
        temperature: 0.7,
        system: [
          {
            type: "text",
            text: systemPromptText,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: pastMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      if (response.status === 429) {
        return NextResponse.json({ error: "APIのレート制限に達しました。少し待ってから再度お試しください。" }, { status: 429 });
      }
      return NextResponse.json({ error: "AIからの応答取得に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawContent = data.content?.[0]?.text;
    const aiContent = rawContent && rawContent.trim() !== ""
      ? rawContent
      : "応答の生成に失敗しました。もう一度お試しください。";

    const saved = await prisma.advisorChatMessage.create({
      data: { sessionId, role: "assistant", content: aiContent },
    });

    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ message: saved });
  } catch (e: unknown) {
    clearTimeout(timeoutId);

    if (e instanceof Error && e.name === "AbortError") {
      console.error("Anthropic API timeout after", API_TIMEOUT_MS, "ms");
      await prisma.advisorChatMessage.create({
        data: {
          sessionId,
          role: "assistant",
          content: "すみません、応答の生成に時間がかかりすぎました。ファイルの内容が大きい場合は、要点を絞ってご質問ください。",
        },
      });
      return NextResponse.json({ error: "タイムアウトしました" }, { status: 504 });
    }

    console.error("Anthropic API call error:", e);
    return NextResponse.json({ error: "AIからの応答取得に失敗しました" }, { status: 500 });
  }
}

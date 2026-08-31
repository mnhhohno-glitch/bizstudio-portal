import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  parsePdfWithAI,
  parseImageWithAI,
  parseDocWithAI,
  parseTextFile,
} from "@/lib/file-parser";
import { getJobMatchingSkillFull } from "@/lib/load-job-matching-skill";
import { computeContextFingerprint } from "@/lib/advisor-context";
import { isAnalysisMessage } from "@/lib/advisor-message-kind";
import { CLAUDE_MODEL_DEFAULT } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { isDiagnosisContent, runDiagnosisExtraction } from "@/lib/advisor/diagnosis-extract";
// T-184: タイプ診断のついでに未読の面談ログを要約保存＋既読化する。部品は T-155 の取り込み実装と共有。
import {
  collectUnreadLogs,
  buildDigestUserContent,
  buildInlineDigestInstruction,
  extractLogDigestBlock,
  saveIngestedDigest,
  type UnreadLogBundle,
} from "@/lib/advisor/log-ingest";
// T-150: 検出指示（TASK_DETECTION_PROMPT）は lib 側に置き、route と検証スクリプトで
// 同じ実文言を参照する（route ファイルは Next.js の制約で任意の定数を export できないため）。
import {
  extractSuggestedTasks,
  pendingKindsFromMessages,
  dropAlreadyPendingKinds,
  TASK_DETECTION_PROMPT,
} from "@/lib/advisor/suggested-tasks";

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

// T-164: contextキャッシュの主判定は contextFingerprint（材料が変わったか）。
// この定数は指紋計算に漏れがあっても1日で必ず作り直すための上限TTL（安全弁）。
const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_PAST_MESSAGES = 20;
// T-163: API送信用の1メッセージ本文クランプ。面談ログ全文貼り付け（実測 max 32,104字）等への防御。
// analyze-batch 側の MAX_CHAT_MESSAGE_CHARS とは独立に定義する。DB・画面表示には影響させない。
const MAX_PAST_MESSAGE_CHARS = 4000;
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

// LIGHTモード（needsSkillPrompt / SKILL_KEYWORDS / LIGHT_SYSTEM_PROMPT によるキーワード分岐）は
// 2026-07-17 に廃止。キーワード非マッチ時にスキルが完全脱落し、実績値・憧れ枠等の
// スキル固有知識を答えられない構造問題があったため、常時フル版スキル注入に統一した。

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
  return CLAUDE_MODEL_DEFAULT;
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
  // T-184: typeDiagnosis はパネルの「タイプ診断」ボタン経路だけが true で送る明示フラグ。
  // 固定文の一致判定にしないのは、CA が自由入力で似た文言を打っても誤発火させないため。
  const { content, file, typeDiagnosis } = await req.json();

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
      // T-135: 添付OCRの費用を候補者・呼び出し元つきで帳簿へ（記録は file-parser 内で実施）
      const logMeta = { candidateId, caller: "advisor-chat-attachment" };
      if (mt === "application/pdf") {
        fileContext = await parsePdfWithAI(file.base64, logMeta);
      } else if (mt.startsWith("image/")) {
        fileContext = await parseImageWithAI(file.base64, mt, logMeta);
      } else if (mt === "text/plain" || mt === "text/csv") {
        const fullText = parseTextFile(file.base64);
        fileContext = fullText.length > MAX_TEXT_FILE_CHARS
          ? fullText.substring(0, MAX_TEXT_FILE_CHARS) + `\n\n...（以下省略、全${fullText.length}文字）`
          : fullText;
      } else if (mt.includes("word") || mt.includes("document") || mt.includes("excel") || mt.includes("spreadsheet") || mt.includes("powerpoint") || mt.includes("presentation")) {
        fileContext = await parseDocWithAI(file.base64, mt, logMeta);
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
  // T-163: 求人全件分析の産物（完了カード・旧バッチ出力）は AI への送信窓から除外して
  // 「直近20件」を数える。除外は API 送信のみで、DB・画面表示には一切影響しない。
  // 分析結果そのものは候補者context の評価一覧（advisor-context.ts）経由で AI に届く。
  const allMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  const pastMessages = allMessages
    .filter((m) => !isAnalysisMessage(m))
    .slice(-MAX_PAST_MESSAGES);

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
    select: { contextCache: true, contextCachedAt: true, contextFingerprint: true },
  });

  let context = session?.contextCache || "";

  // T-164: 失効判定を「経過時間」から「材料の指紋一致」に変更。
  //   旧30分TTLは (1) 材料が変わらなくても30分ごとに再ビルド（従来15.5秒の待ち）
  //   (2) 逆に30分以内は全件分析直後でも古い評価のまま、の両方の問題があった。
  //   指紋が一致すれば経過時間に関係なくキャッシュを使い、変わっていれば即再ビルドする。
  //   CACHE_TTL(24h) は指紋計算の漏れがあっても1日で必ず作り直すための安全弁。
  const fingerprint = await computeContextFingerprint(candidateId);
  const cacheExpired = !session?.contextCachedAt ||
    Date.now() - new Date(session.contextCachedAt).getTime() > CACHE_TTL;
  const fingerprintChanged = session?.contextFingerprint !== fingerprint;

  // T-163: contextビルド所要時間の実測。キャッシュヒット（再ビルドなし）は 0 のまま。
  let contextBuildMs = 0;

  if (!context || cacheExpired || fingerprintChanged) {
    const contextT0 = Date.now();
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
          data: {
            contextCache: context,
            contextCachedAt: new Date(),
            contextFingerprint: fingerprint,
          },
        });
      }
    } catch (e) {
      console.error("Context fetch error:", e);
    }
    contextBuildMs = Date.now() - contextT0;
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

  // T-184: タイプ診断のときだけ、未読の面談ログ全文を「この1回のコール」に同梱する。
  // 「未読ログ取込」ボタンを押さない限り advisorLogDigest / advisorIngestedAt が更新されず
  // 未読が残り続けるため、診断のついでに要約＋既読化まで済ませる（AI呼び出し回数は増やさない）。
  // 未読の判定条件・入力ガードは T-155 の取り込みと同一（collectUnreadLogs を共有）。
  // 収集に失敗しても診断は通常どおり実行する（同梱を諦めるだけ＝次回押下で再試行できる）。
  let digestBundle: UnreadLogBundle | null = null;
  if (typeDiagnosis) {
    try {
      const collected = await collectUnreadLogs(candidateId);
      if (!collected.ok) {
        console.warn(`[advisor-chat] T-184 collectUnreadLogs failed (non-fatal): ${collected.error}`);
      } else if (collected.bundle.logs.length > 0) {
        digestBundle = collected.bundle;
      }
    } catch (e) {
      console.warn("[advisor-chat] T-184 collectUnreadLogs threw (non-fatal):", e);
    }
  }

  // LIGHTモード廃止: 常にフル版スキルを注入する。
  // 旧実装はキーワード分岐（needsSkillPrompt）でFULL/LIGHTを切り替えていたが、キーワードに
  // マッチしない質問（実績値・憧れ枠等のスキル固有知識を問うもの）でスキルが完全脱落する
  // 構造問題があったため常時FULLに統一（2026-07-17 将幸さん決定）。
  // キャッシュ最適化: 固定(PERSONA+skill)を独立ブロック化し cache_control 付与、
  // 可変(候補者context)を別ブロックに分離（候補者横断で skill がキャッシュ読みになる）。
  const systemBlocks = [
    {
      type: "text" as const,
      text: ADVISOR_PERSONA_PROMPT + getJobMatchingSkillFull() + TASK_DETECTION_PROMPT,
      cache_control: { type: "ephemeral" as const },
    },
    {
      // T-164: 候補者contextにも cache_control を付与（従来は毎ターン満額処理＝取りこぼし）。
      //   指紋方式（T-164）で context のバイト列が安定する時間が延びたため read 化が見込める。
      //   TTL は既定の5分のまま（1時間TTLは 60分以内再コール率 54.0% < 損益分岐 57.5% のため不採用）。
      //   第2ブロック単体の損益分岐はヒット率 21.7%超（write 1.25x / read 0.1x）。実測 37.4% で黒字見込み。
      type: "text" as const,
      text: CANDIDATE_DATA_HEADER + context,
      cache_control: { type: "ephemeral" as const },
    },
  ];

  // T-150: 検出根拠を「今回CAが打鍵した分」だけに構造で限定する。
  // pastMessages の最終要素は今回のユーザー発言そのもの（L204-206 で保存 → L209-213 で取り直すため）。
  // 別枠で追加すると同じ発言が2回 API に乗る（費用増＋検出の不安定化）ので、最終要素を差し替える。
  // content（CA打鍵分）と fileContext（添付解析結果）は別変数のまま存在するため、
  // 添付ファイルの中身が <ca_input> に入る経路自体が存在しなくなる（プロンプトの指示に頼らない分離）。
  // T-163: API送信用に限り 1メッセージ 4,000字でクランプ（DB・画面表示には影響しない）。
  const apiMessages = pastMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content:
      m.content.length > MAX_PAST_MESSAGE_CHARS
        ? m.content.substring(0, MAX_PAST_MESSAGE_CHARS) + "\n…（長いため省略）"
        : m.content,
  }));

  const lastIdx = apiMessages.length - 1;
  if (lastIdx >= 0 && apiMessages[lastIdx].role === "user") {
    const attachedFileName = file?.name || "添付ファイル";
    // 添付のみ送信時、UI（AdvisorFloatingPanel）は content に "添付ファイル: <name>" という
    // 合成文字列を入れる（＝CAは何も打鍵していない）。これを打鍵分として渡すと、
    // ファイル名の文言で誤検出しうるため ca_input を空にする。
    const typed = (content ?? "").trim();
    const isSyntheticAttachmentLabel = !!file && typed === `添付ファイル: ${file?.name ?? ""}`;
    const caInput = isSyntheticAttachmentLabel ? "" : typed;

    // T-184: 未読ログ本文と要約指示は cache_control 付きの固定ブロックではなく、
    // ここ（可変側＝ユーザーメッセージ）に載せる（罠#39: 固定ブロックに可変内容を混ぜない）。
    // <ca_input> の外なので、タスク候補検出（TASK_DETECTION_PROMPT）の根拠にもならない。
    apiMessages[lastIdx] = {
      role: "user",
      content:
        `<ca_input>\n${caInput}\n</ca_input>\n` +
        (fileContext ? `\n<attachment name="${attachedFileName}">\n${fileContext}\n</attachment>\n` : "") +
        (digestBundle
          ? `\n<unread_meeting_logs>\n${buildDigestUserContent(digestBundle)}</unread_meeting_logs>\n` +
            buildInlineDigestInstruction(digestBundle.logs.length)
          : ""),
    };
  } else if (digestBundle) {
    // 差し替え先が無い（想定外）ときは同梱を諦める。指示だけ出て抽出が必ず失敗するのを防ぐ。
    console.warn("[advisor-chat] T-184 last message is not user; skip digest bundling");
    digestBundle = null;
  }

  const usedModel = selectModel(content || "", !!file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  // T-163: Anthropic API 呼び出しの所要時間の実測。
  const apiT0 = Date.now();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: usedModel,
        // T-184: ダイジェスト同梱時のみ出力上限を広げる。診断本文（従来4,000で足りている）に
        // 最大4,000字のダイジェストが後続するため、据え置きだと本文か区切り文字が途中で切れる。
        // 同梱しない通常のチャット・診断は従来どおり 4,000。
        max_tokens: digestBundle ? 10000 : 4000,
        temperature: 0.7,
        system: systemBlocks,
        messages: apiMessages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      // T-126: 失敗コールも記録（失敗率の可視化）。
      await recordAdvisorUsage({
        endpoint: "advisor-chat",
        model: usedModel,
        usage: null,
        candidateId,
        note: `error-${response.status}`,
        latencyMs: Date.now() - apiT0,
        contextBuildMs,
      });
      if (response.status === 429) {
        return NextResponse.json({ error: "APIのレート制限に達しました。少し待ってから再度お試しください。" }, { status: 429 });
      }
      return NextResponse.json({ error: "AIからの応答取得に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const u = data.usage ?? {};
    const latencyMs = Date.now() - apiT0;
    console.log(`[advisor usage] input=${u.input_tokens} output=${u.output_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} latency_ms=${latencyMs} context_build_ms=${contextBuildMs}`);
    // T-126: usage を永続化。LIGHTモード廃止後は常に skill-full。
    await recordAdvisorUsage({
      endpoint: "advisor-chat",
      model: usedModel,
      usage: u,
      candidateId,
      // T-184: ダイジェスト同梱の有無を帳簿から識別できるようにする（費用比較のため）。
      note: digestBundle ? `skill-full;t184-digest-${digestBundle.logs.length}` : "skill-full",
      latencyMs,
      contextBuildMs,
    });
    const rawContent = data.content?.[0]?.text;
    const aiContent = rawContent && rawContent.trim() !== ""
      ? rawContent
      : "応答の生成に失敗しました。もう一度お試しください。";

    // T-184: 先にダイジェストブロックを剥がす。画面表示・advisorChatMessage 保存・返却の
    // いずれにも <<<LOG_DIGEST>>> を残さない。
    // ★fail-closed: ブロックが無い・空・保存失敗のときは advisorIngestedAt を立てない
    //   （未読のまま残り、次回のタイプ診断か「未読ログ取込」ボタンで再試行できる）。
    let ingestedLogCount = 0;
    let contentForChat = aiContent;
    if (digestBundle) {
      const { cleanContent: strippedContent, digest } = extractLogDigestBlock(aiContent);
      contentForChat = strippedContent;
      if (!digest) {
        console.warn(
          `[advisor-chat] T-184 digest block missing or empty (fail-closed, not ingested) candidateId=${candidateId}`,
        );
      } else {
        try {
          await saveIngestedDigest({
            candidateId,
            digest,
            fileIds: digestBundle.logs.map((l) => l.id),
          });
          ingestedLogCount = digestBundle.logs.length;
          console.log(
            `[advisor-chat] T-184 ingested=${ingestedLogCount} digestChars=${digest.length} candidateId=${candidateId}`,
          );
        } catch (e) {
          console.warn("[advisor-chat] T-184 digest save failed (fail-closed, not ingested):", e);
        }
      }
    }

    // T-150: 応答本文に併記されたタスク候補 JSON を剥がし、期日を JST で確定させる。
    // 失敗しても候補なしとして続行する（チャット応答は必ず成立させる＝fail-open）。
    // DB に保存するのは必ず cleanContent 側（生保存すると画面に JSON が出るうえ、
    // 次ターンの messages に乗って AI が自分の過去 JSON を模倣する）。
    const { cleanContent, suggestedTasks: detectedTasks } = extractSuggestedTasks(contentForChat);

    // 同一セッションで未処理の候補が既にある種別は落とす。
    // 検出根拠を今回の <ca_input> に限定しても、AI は履歴に残る過去ターンの約束を拾って
    // 毎ターン同じ候補を出す（staging 実測）。カードが毎ターン再出現するのを決定的に抑止する。
    // allMessages（L209-212 で取得済み）は今回より前の全メッセージを全カラム含むので追加クエリ不要。
    const pendingKinds = pendingKindsFromMessages(allMessages);
    const suggestedTasks = dropAlreadyPendingKinds(detectedTasks, pendingKinds);
    if (detectedTasks.length > suggestedTasks.length) {
      console.log(
        `[advisor-chat] suggestedTasks suppressed (already pending in session): ` +
          detectedTasks.filter((t) => !suggestedTasks.includes(t)).map((t) => t.kind).join(","),
      );
    }
    if (suggestedTasks.length > 0) {
      console.log(
        `[advisor-chat] suggestedTasks detected candidateId=${candidateId} ` +
          suggestedTasks.map((t) => `${t.kind}(${t.due}→${t.dueDate})`).join(" "),
      );
    }

    const saved = await prisma.advisorChatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: cleanContent,
        // 候補0件のときは null のままにする（空配列を入れない）。
        suggestedTasks: suggestedTasks.length > 0 ? suggestedTasks : undefined,
      },
    });

    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    // T-132: 診断応答が来たら「完了直後」に別コールで希望条件を構造化保存する（後読み）。
    // 診断の判定は content ヒューリスティック（検索条件（推奨）/職種キーワード）。
    // fire-and-forget（await しない）。失敗はログのみで、チャット応答・診断体験に一切影響させない。
    // ※ portal は Railway の常駐 Node のためレスポンス返却後も継続実行される（Vercel lambda と異なる）。
    // T-150: 渡すのは候補 JSON を剥がした後の本文。判定キーワード（検索条件（推奨）/職種キーワード）に
    // JSON はマッチしないため判定結果は変わらないが、Gemini 抽出の入力にノイズを乗せない。
    if (isDiagnosisContent(cleanContent)) {
      void runDiagnosisExtraction({
        candidateId,
        sessionId,
        messageId: saved.id,
        diagnosisText: cleanContent,
      }).catch((e) => console.error("[advisor-chat] diagnosis extraction failed:", e));
    }

    // T-184: 取り込めた件数を返す。UI はこれで未読件数の再取得とトースト表示を出し分ける
    //（0件＝同梱しなかった／fail-closed のときは何も出さない）。
    return NextResponse.json({
      message: saved,
      ...(ingestedLogCount > 0 ? { logIngest: { ingested: ingestedLogCount } } : {}),
    });
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

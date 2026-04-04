import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  parsePdfWithAI,
  parseImageWithAI,
  parseDocWithAI,
  parseTextFile,
} from "@/lib/file-parser";

const SYSTEM_PROMPT_TEMPLATE = `# Role & Persona

あなたは人材紹介会社「株式会社ビズスタジオ」のシニアキャリアアドバイザーです。
担当CAと一緒に、以下の求職者の転職支援を行います。

## あなたの専門性
- 年間200名以上の転職支援実績
- 求職者の本質的な価値観・動機を読み取る力
- 面接官の評価基準を熟知し、的確なアドバイスができる
- 求人マッチングの精度が高い

## 回答スタイル
- CAとの自然な会話を意識する。毎回長文レポートを書かない
- 質問の深さに応じて回答の長さを調整する：
  - 簡単な確認や短い質問 → 1〜3文で簡潔に答える
  - 具体的な相談や分析依頼 → 必要な分だけ詳しく答える（それでも要点を絞る）
  - 複雑な戦略相談 → 構造化して丁寧に答える
- 聞かれていないことまで先回りして書かない
- 「何か他にありますか？」等の定型的な締めは不要

## 求職者分析時の出力ルール

タイプ診断やWill-Can-Must分析を行った場合、分析結果だけで終わらず、必ず以下の「CA向け検索戦略アドバイス」をセットで出力すること。CAが今すぐ求人検索に動けるレベルの具体的な提案を行うこと。

### 必ず出力する項目

■ 検索条件（推奨）
- 職種キーワード（具体的な検索ワード）
- 業種（S→A→Bの優先度付きで提案。Sは最優先、Bは幅を広げる場合）
- 年収レンジ（理想と許容下限を明記）
- エリア（最寄駅から現実的な通勤圏）
- フリーワード（「未経験」「第二新卒」等、検索に使うべきワード）
- 休日・残業の条件

■ 避けるべき求人の特徴
- この求職者に合わない求人の具体的な特徴を列挙
- 例：固定残業30時間超、少人数で孤立しやすい環境、インセンティブ比率が高い等

■ 提案時の注意点
- この求職者が応募を躊躇しそうなポイント
- エントリー率を上げるために先回りして説明すべきこと
- 書類通過率の見込みと、通過率を上げるための工夫

■ 書類作成のポイント
- 職務経歴書でどこを強調すべきか
- この求職者の経歴で企業に刺さるアピールポイント

### 出力しない場合
- 雑談や簡単な確認質問など、分析を求められていない場合はこのフォーマットを使わない
- 「タイプ診断して」「この人の分析をして」「検索戦略を教えて」等の明確な分析依頼があった場合のみ、上記フォーマットで出力する

## 読みやすいフォーマット
- 話題が変わるときは必ず空行を入れて段落を分ける
- 3社以上の比較や複数ポイントの説明は、見出し（■や【】）や箇条書きで整理する
- 1つの段落は3〜4文まで。長くなりそうなら段落を分割する
- 結論やおすすめ順位は最初か最後にまとめて、パッと見で分かるようにする
- ただし短い回答のときは無理にフォーマットしない。1〜2文なら装飾不要

## 行動指針
- CAの質問や相談に対して、この求職者のデータを踏まえてアドバイスする
- 求職者の強み・課題を客観的に分析する
- 求人の提案時は、転職軸との一致度を説明する
- 日本語で回答する

---

## 求人マッチングフレームワーク

以下のフレームワークに基づいて求職者分析・求人マッチングを行うこと。

### 書類・面談ログの読み方

職務経歴書は「スキルシート」ではなく「意思決定の記録」として読む。
- 全体俯瞰：転職回数と在籍期間のパターンからキャリアの一貫性を見る
- 書類の記入量からは「温度感」ではなく「取り組み姿勢」を読む
- 自己PRの内容は読まない。文字量だけで熱量を判断する
- 実績記載は誇張が多いため額面通りに受け取らない

**温度感判定の分岐（重要）:**
- 記入量が少ない場合、まず「書けないのか、書かないのか」を判定する
- 自衛隊・警察・消防・教師・公務員・高卒で特殊業界のみ → 「書き方がわからないだけ」の可能性が高い
- 過去の転職失敗経験がある場合 → 温度感が低いのではなく「慎重さが行動を止めている」パターン
- 紹介経由で書類がない場合 → 面談ログから基本スペック・業務内容・退職理由・希望条件・性格を抽出して分析する

**ポータブルスキル抽出:** 対人スキル、課題設定・解決力、数値管理力、セルフマネジメントの4軸で評価する

### 6タイプ志向性診断

求職者が仕事に魅力を感じるドライバーを主タイプ＋副タイプで判定する：

| タイプ | 判断基準 | 求人マッチングへの影響 |
|---|---|---|
| 成果・達成型 | 数字・目標達成に燃える | KPI・インセンティブ重視の求人 |
| 専門深化型 | 一つの領域を極めたい | 専門性を深められるポジション |
| 影響・裁量型 | 自分の判断で動きたい | 裁量が大きいポジション |
| 関係構築型 | 人との関わりが原動力 | チーム営業・CS・社内調整系 |
| 安定・環境型 | 条件面の安心感が土台 | 大手・老舗・福利厚生充実 |
| カルチャー重視型 | 企業の雰囲気やブランドに惹かれる | ネームバリュー・社風が明確な企業 |

- 多くの求職者は複合タイプ。主タイプ＋副タイプの組み合わせで判定する
- 安定・環境型とカルチャー重視型は似て見えるが提案する求人が異なる

### Will-Can-Must分析

- Will（やりたいこと）：本人の希望・キャリアビジョン
- Can（できること）：現在のスキル・経験・実績
- Must（求められること）：市場が求める人材要件
- 3つが重なる領域が最も現実的なマッチングゾーン

### 面談の核心テクニック

- **逆転質問：**「今の会社がどういう状況だったら辞めなかったですか？」→ 本当に譲れない条件が浮かぶ
- **年収の本気度検証：** 年収は最後に覆る条件の第一位。具体的な金額を突きつけて即答かどうかで判定
- **20代の隠れ承認欲求パターン：** 表面上控えめだが承認欲求が高く打たれ弱い。面接不合格時のフォローが特に重要

**危険シグナル：**
- 面接リスケ → 他社選考進展・志望度低下の可能性
- 「考えます」の多用 → 他の選択肢を温めている
- 全ての求人に「いいですね」 → 判断基準が弱い

### 求人検索戦略

**検索の優先順位（目の動き）：**
1. 必須要件（通るかどうか）← 最初に見る
2. 求人タイトル・会社名・業種（方向性）
3. 年収レンジ（レベル感）
4. 仕事内容（具体的業務）

**年収判断基準：**
- 理想レンジ：希望年収−50万〜+100万
- 許容下限：希望年収−100万
- それ以下は事前に求職者の了承が必要

**固定残業時間による安定度スコアリング（安定志向の場合）：**
- 記載なし（0時間）→ 実質20時間と想定（額面通りに受け取らない）
- 10時間以内 → A / 20時間以内 → B / 30時間以内 → C / 30時間超 → D

**業種提案の優先度（S→A→B）：**
- S（最優先）：本人が好き・経験がある・志望度が高い業界
- A：Sと類似業界またはスキルが直結する業界
- B：スキルは活かせるが業界が異なる
- 業界愛がある場合、年収が多少低くてもSランク業界の方が定着率・承諾率が高い

**業界NGの見分け：**
- ハードNG（理由明確・感情的拒否）→ 完全除外
- ソフトNG（漠然とした苦手意識）→ 内容が合う求人を少量混ぜて反応を見る

### ABCD二軸マトリックス評価

**軸1：本人希望適合度**
- A：志向性も条件もほぼ一致 / B：方向性は合うが条件が足りない / C：条件は合うが方向性が違う / D：両方不適

**軸2：選考通過率**
- A：必須要件十分クリア＋通過実績あり＋温度感高い / B：要件クリア＋一部不確定 / C：要件は満たすが不安要素あり / D：要件不十分

**通過率の判断で特に注意すべき点：**
- 必須要件のみで選考の角度を読み取るのは危険（裏の基準がある）
- 業務委託・BPO・派遣での経験は、自社運営の経験より書類評価が低い
- 同じスペック・同じ求人でもタイミング（応募倍率）で結果が変わる

**提案の注意：**
- 求職者にABCDランクは見せない（信頼関係保護）
- Aランクは「おすすめ求人」「ピックアップ求人」として提案
- 自信がない求職者には難しい求人と通る求人を半々で出す（市場理解＋自信維持の両立）

### クロージング

**承諾を迷っている場合：** 感情論ではなくデータと確率で現実を提示する
1. 選考状況を数字で整理（応募数→通過数→通過率）
2. この内定を手放した場合のシミュレーション提示
3. 最後に逃げ道を用意する（「長期でやるならそれでもいいと思いますよ」）

### ミドル層（35歳以上）対応

- **段階的提案：** 希望でグリップ → 書類で落ちて市場理解 → 経験業種のより良い環境を提案
- **38歳×未経験業種＝書類は絶望的** と覚悟し、通らない求人も戦略的に出す（市場理解のため）
- 退職理由の解像度を上げる：「業界嫌い」ではなく「商材の将来性への不安」の場合、同業界の成長企業が最適解
- **書類通過は推薦状より職務経歴書の作り込みが最大レバー**
- 学歴フィルター対応：大手より中堅企業・実力主義企業を中心に

---

# 求職者データ

`;

const CACHE_TTL = 30 * 60 * 1000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_PAST_MESSAGES = 20;
const MAX_TEXT_FILE_CHARS = 8000;
const API_TIMEOUT_MS = 120000; // 2分

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
        model: "claude-opus-4-6",
        max_tokens: 4000,
        temperature: 0.7,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT_TEMPLATE + context,
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

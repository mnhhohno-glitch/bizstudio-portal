import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getCandidateContext } from "@/lib/advisor-context";
import { getJobMatchingSkill } from "@/lib/load-job-matching-skill";
import { CLAUDE_MODEL_ANALYSIS } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

export const maxDuration = 300; // 5 minutes

function hasValidThreeAxisMarkers(comment: string | null | undefined): boolean {
  if (!comment) return false;
  const c = comment.replace(/\*\*/g, "");
  const hasDesire = /■\s*本人希望[：:]\s*[ABCD]/.test(c);
  const hasPass = /(?:■\s*)?通過率[：:]\s*[ABCD]/.test(c);
  const hasOverall = /(?:■\s*)?総合[：:]\s*[ABCD]/.test(c);
  return hasDesire && hasPass && hasOverall;
}

function extractRatingsAndComments(
  analysisText: string,
  batchFiles: { id: string; fileName: string }[]
): Map<string, { rating: string; comment: string }> {
  const results = new Map<string, { rating: string; comment: string }>();

  // === Phase 1: Extract ratings from summary section ===
  const summaryMatch = analysisText.match(/【総合優先順位[^】]*】([\s\S]*?)(?:$|\n\n\n)/);
  const summarySection = summaryMatch ? summaryMatch[1] : "";

  if (summarySection) {
    const summaryRatings = new Map<string, string>();
    let currentRating = "";

    for (const line of summarySection.split("\n")) {
      const trimmed = line.trim();
      if (/^[ABCD]$/.test(trimmed)) { currentRating = trimmed; continue; }
      if (trimmed === "該当なし" || trimmed === "") continue;
      if (trimmed.startsWith("*")) {
        const cn = trimmed.replace(/^\*\s*/, "").trim();
        if (cn && cn !== "該当なし" && currentRating) summaryRatings.set(cn, currentRating);
        continue;
      }
      if (currentRating && trimmed.length > 1 && !trimmed.startsWith("【")) {
        summaryRatings.set(trimmed, currentRating);
      }
    }

    for (const file of batchFiles) {
      if (results.has(file.id)) continue;
      const searchNames = extractSearchNames(file.fileName);
      for (const [summaryCompany, rating] of summaryRatings) {
        for (const name of searchNames) {
          if (
            summaryCompany.includes(name) ||
            name.includes(summaryCompany) ||
            normalizeCompanyName(summaryCompany) === normalizeCompanyName(name)
          ) {
            results.set(file.id, { rating, comment: "" });
            break;
          }
        }
        if (results.has(file.id)) break;
      }
    }
  }

  // === Phase 2: Extract individual section comments + fallback ratings ===
  // Use space-normalized text for matching (length-preserving, so indices map to original)
  const normalizedText = normalizeSpaces(analysisText);

  for (const file of batchFiles) {
    const searchNames = extractSearchNames(file.fileName);

    for (const name of searchNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Try multiple section header patterns:
      // 1. Current AI format: ## 【会社名】 / ### 【会社名】 / **【会社名】**
      // 2. Legacy: 【会社名】 (bare)
      // 3. Legacy: 求人N: ファイル名
      const sectionPatterns = [
        // 行頭アンカー + Markdown見出し/太字装飾許容
        new RegExp(`(?:^|\\n)(?:#{1,3}\\s*)?(?:\\*\\*\\s*)?【[^】]*${escaped}[^】]*】`, "i"),
        // 素の【...】マッチ（行中含む）
        new RegExp(`【[^】]*${escaped}[^】]*】`, "i"),
        // 旧フォーマット
        new RegExp(`(?:###?\\s*)?求人\\d+[：:]\\s*[^\\n]*${escaped}`, "i"),
      ];

      let startIndex = -1;
      for (const pattern of sectionPatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
          const matchedText = match[0];
          const rawIndex = normalizedText.indexOf(matchedText);
          if (rawIndex !== -1) {
            // 先頭の \n や ## や ** 分を除外して 【 の位置にずらす
            const braceOffset = matchedText.indexOf("【");
            startIndex = braceOffset >= 0 ? rawIndex + braceOffset : rawIndex;
            break;
          }
        }
      }

      // Also try direct name search as fallback
      if (startIndex === -1) {
        startIndex = normalizedText.indexOf(name);
        if (startIndex !== -1) {
          // Walk back to find section start (--- or line start)
          const before = analysisText.substring(Math.max(0, startIndex - 200), startIndex);
          const lastSep = before.lastIndexOf("---");
          if (lastSep !== -1) {
            startIndex = startIndex - 200 + lastSep + before.length - before.lastIndexOf("---");
            startIndex = Math.max(0, startIndex - 200) + lastSep + 3;
          }
        }
      }

      if (startIndex === -1) continue;

      // セクション終端: 次の会社セクション（## 【】 / **【】 / 空行後の裸【】）・総合まとめ・旧求人N:
      // ※ \n--- は求人内部の区切りにも使われるため終端に含めない（推薦本文まで取り込む）
      const afterStart = analysisText.substring(startIndex);
      const nextSection = afterStart
        .slice(1)
        .match(/\n##\s+【[^】]+】|\n\*\*\s*【[^】]+】|\n\n【[^】]+】|\n(?:###?\s*)?求人\d+[：:]|\n━━━/);
      const endIndex = nextSection
        ? startIndex + 1 + (nextSection.index || afterStart.length)
        : startIndex + Math.min(afterStart.length, 3000);

      const comment = analysisText.substring(startIndex, endIndex).trim();

      if (comment.length > 10) {
        const existing = results.get(file.id);
        if (existing) {
          existing.comment = comment;
        } else {
          const ratingMatch = comment.match(/■\s*総合[：:]\s*([ABCD])/) || comment.match(/総合[：:]\s*([ABCD])/);
          results.set(file.id, { rating: ratingMatch ? ratingMatch[1] : "", comment });
        }
        break;
      }
    }

    // Fallback: rating from nearby text if still no rating
    const entry = results.get(file.id);
    if (entry && !entry.rating) {
      for (const name of searchNames) {
        const idx = normalizedText.indexOf(name);
        if (idx === -1) continue;
        const area = analysisText.substring(Math.max(0, idx - 100), Math.min(analysisText.length, idx + 600));
        const patterns = [/■\s*総合[：:]\s*([ABCD])/, /総合[：:]\s*([ABCD])/, /評価[：:]\s*([ABCD])/, /【([ABCD])】/];
        for (const p of patterns) {
          const m = area.match(p);
          if (m) { entry.rating = m[1]; break; }
        }
        if (entry.rating) break;
      }
    }

    // Fallback: Phase 2 が失敗した場合は「rating だけ保存/comment NULL」を
    // 量産しないよう、results には追加せずスキップする（警告ログのみ）。
    if (!results.has(file.id)) {
      console.warn(
        `[AnalyzeBatch] Phase2 failed to extract section, skipping partial save: fileId=${file.id}, fileName="${file.fileName}", searchNames=${JSON.stringify(searchNames)}`
      );
    }
  }

  return results;
}

function extractSearchNames(fileName: string): string[] {
  const names: string[] = [];
  let name = fileName.replace(/\.pdf$/i, "");

  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/);
  if (p1) names.push(p1[1]);

  const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/);
  if (p2) names.push(p2[1]);

  const p3 = name.match(/^(.+?)_No\d+$/i);
  if (p3) names.push(p3[1]);

  const pBee = name.match(/^(.+?)[：:]\d+$/);
  if (pBee && pBee[1]) names.push(pBee[1].trim());

  const p4 = name.match(/^求人票[_]?(.+)$/);
  if (p4 && !names.includes(p4[1])) names.push(p4[1]);

  if (names.length === 0) names.push(name);

  // Normalize full-width spaces to half-width in all names
  for (let i = 0; i < names.length; i++) {
    names[i] = normalizeSpaces(names[i]);
  }

  const expanded: string[] = [...names];
  for (const n of names) {
    const stripped = n
      .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
      .trim();
    if (stripped.length >= 2 && !expanded.includes(stripped)) {
      expanded.push(stripped);
    }
    // Fullwidth → halfwidth version
    const normalized = n
      .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    if (normalized !== n && !expanded.includes(normalized)) {
      expanded.push(normalized);
    }
  }
  return expanded;
}

/** Replace full-width spaces with half-width (length-preserving) for matching */
function normalizeSpaces(str: string): string {
  return str.replace(/　/g, " ");
}

function normalizeCompanyName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[・]/g, "")
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
}

const API_TIMEOUT_MS = 300000;
const MAX_PAST_MESSAGES = 30;
const MAX_CONTEXT_CHARS = 20000;
const MAX_CHAT_MESSAGE_CHARS = 4000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode");
  const body = await req.json();
  const { sessionId, batchIndex, batchSize, totalFiles, isLastBatch, sinceDate } = body as {
    sessionId: string;
    batchIndex: number;
    batchSize: number;
    totalFiles: number;
    isLastBatch: boolean;
    sinceDate?: string;
  };

  if (!sessionId || batchIndex == null || !batchSize || !totalFiles) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 1. Fetch bookmark files with extracted text (optionally filtered by date)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = {
    candidateId,
    category: "BOOKMARK",
    extractedText: { not: null },
    archivedAt: null,
  };
  if (sinceDate) {
    whereClause.createdAt = { gt: new Date(sinceDate) };
  }

  const fetchedBookmarks = await prisma.candidateFile.findMany({
    where: whereClause,
    select: {
      id: true,
      fileName: true,
      extractedText: true,
      aiAnalysisComment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // invalid-only mode:
  //   - aiAnalysisComment が NULL/空 → 対象
  //   - 3軸マーカーが欠落している → 対象
  //   - それ以外（正常）は除外
  const allBookmarks = mode === "invalid-only"
    ? fetchedBookmarks.filter((f) => {
        if (!f.aiAnalysisComment || f.aiAnalysisComment.trim() === "") return true;
        if (!hasValidThreeAxisMarkers(f.aiAnalysisComment)) return true;
        if (!f.aiAnalysisComment.includes("◆")) return true;
        return false;
      })
    : fetchedBookmarks;

  // 2. Get batch slice
  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, allBookmarks.length);
  const batchFiles = allBookmarks.slice(start, end);

  if (batchFiles.length === 0) {
    return NextResponse.json({ error: "No files in this batch" }, { status: 400 });
  }

  // 3. Get candidate context directly (no HTTP fetch needed)
  let candidateContext = "";
  try {
    candidateContext = await getCandidateContext(candidateId);
    // Strip bookmark section (we send job postings separately)
    const bookmarkIdx = candidateContext.indexOf("## ブックマーク求人票");
    if (bookmarkIdx !== -1) {
      candidateContext = candidateContext.substring(0, bookmarkIdx).trim();
    }
  } catch (e) {
    console.error("[AnalyzeBatch] Context error:", e);
  }

  // Truncate context to prevent oversized payloads
  if (candidateContext.length > MAX_CONTEXT_CHARS) {
    candidateContext = candidateContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
  }

  // 4. Build job posting section for this batch (uses DB-stored extracted text - no PDF binary)
  const jobsSection = batchFiles
    .map((f, i) => {
      const globalIndex = start + i + 1;
      const fullText = f.extractedText || "";
      const text = fullText.substring(0, 3000);
      console.log(`[AnalyzeBatch] Using extracted text: ${f.fileName} (${fullText.length} chars, sent ${text.length})`);
      return `### 求人${globalIndex}: ${f.fileName}\n${text}`;
    })
    .join("\n\n---\n\n");

  // 5. Build system prompt
  let systemPrompt: string;

  const EVAL_RULES = `## 評価ルール

各求人について、以下の3軸でA/B/C/D評価を行うこと。評価基準は上記の「求人マッチングスキル定義」（特に Phase 5: ABCDマッチング評価）に従う。

### ① 本人希望（求職者の希望・志向性とのマッチ度）
- A: 志向性も条件もほぼ一致。本人が間違いなく応募する求人
- B: 方向性は合っているが、条件が何か足りない
- C: 条件は適しているが、方向性が合っていない
- D: 両方適していない

### ② 通過率（書類選考・面接の通過可能性）

**最初に必ず確認：** 必須要件（学歴・資格・経験年数）の充足チェック。未充足ならD判定（推薦状でカバー可能な場合のみC検討）。スキル定義の Phase 5 軸2 を参照。

- A: 必須要件を全て満たした上で+過去の通過実績あり+企業の採用温度感が高い
- B: 必須要件をクリア+一部不確定要素あり
- C: 必須要件は満たすが通過率に不安要素あり、または必須要件未充足だが推薦状でカバー可能性あり
- D: 必須要件の充足が不十分

補足:
- 業務委託・BPO・派遣での経験は、自社運営の経験より書類評価が低くなる傾向
- 35歳以上で未経験業種への応募は書類通過率が大幅に下がる（詳細は付録「ミドル層詳細ガイド」参照）
- 固定残業時間が長い求人（30時間超）は安定志向の求職者にはマイナス評価

### ③ 総合（紹介推奨度）
- A: 積極的に紹介 — 本人希望にも合い、通過も見込める
- B: 紹介してよい — バランスが取れている、または片方が強い
- C: 条件付きで検討 — 紹介するなら補足説明や対策が必要
- D: 紹介非推奨 — 本人にも合わず通過も厳しい

判断材料: ①②の総合判断。本人希望Aでも通過率Dなら総合Cにする等、バランスを考慮（スキル定義 Phase 5 「総合評価」テーブル参照）

## 出力フォーマット
各求人の分析コメントは以下のフォーマットで、簡潔に出力してください。求人と求人の間には必ず空行を2行入れて区切ること：

---

【会社名】求人タイトル

■ 本人希望: A〜D
■ 通過率: A〜D
■ 総合: A〜D

◆ おすすめポイント（本人向け）
評価ランク（A/B/C/D）に関係なく、すべての求人で「積極的・前向きな推薦コメント」を生成する。
マイページに表示される内容なので、本人が読んで前向きに応募を検討できる文章にすること。

■ 全ランク共通の方針
- なぜこの求人が本人に向いているかを具体的に説明する
- 本人の経験・スキル・希望条件のどこかしらにマッチする要素を見つけて明確に記載する
- 「○○さんの△△の経験は、この求人の□□業務で直接活かせます」のように具体的に書く
- 年収・勤務地・働き方など、本人の希望に合致するポイントも具体的に触れる
- 完璧に希望と一致しない場合でも、「この点は合致している」「こういう成長機会がある」「こういう環境が魅力」など前向きな観点を必ず提示する
- 3〜5文程度でしっかり理由を説明する

■ 禁止表現（重要）
以下の表現は絶対に使わない。理由: PDF記載の希望情報は面談で変化していることが多く、現時点の本人の希望と乖離している可能性があるため。

- ❌「○○さんの希望職種第1希望」「第2希望」「第3希望」のような順位特定表現
- ❌「希望職種「具体的な職種名」」のようにPDF記載の具体的希望職種名を引用する表現
- ❌「○○さんの第○希望の××にぴったり合致」のような希望と求人を1対1対応させる表現
- ❌「ご希望の職種「XX」と完全一致」のような断定的なマッチング表現

代わりに以下のように書く:
- ✅「この求人は〜な業務内容で、〜の点が魅力です」（求人内容ベース）
- ✅「○○さんの〜の経験を活かせる環境です」（経験活用ベース）
- ✅「データを扱う業務に関心がある方には魅力的な環境です」（業務領域への関心ベース）
- ✅「○○さんがこれまで培った××スキルが活きるポジションです」（スキル接点ベース）

ポイント: 「本人の希望に合致する」と書くのではなく、「求人の魅力」「本人の経験との接点」を主体に書く。

■ なぜ全ランク前向きにするか（AIへの背景説明）
- ネガティブ要素・選考リスクは「◆ 選考分析（CA向け）」に集約しており、CAが提案前に確認できる
- 本人にこの求人を提案するかどうかはCAが判断した上での提案である
- 提案を決めた以上、本人向けは前向きに書くべき
- 本人向けに不安要素を書くと求職者のモチベーション低下や辞退に繋がる

【絶対ルール】
- 求職者名は「○○さん」で統一する。「あなた」は使わない
- 懸念点・確認事項・ネガティブな選考情報は書かない（それらは CA向けセクションに書く）
- 「希望と異なる」「方向性が違う」「軽めにおすすめ」のようなネガティブ表現は使わない
- 評価ランクA/B/C/Dの違いは本人向けコメントの文体には反映させない（CA向けにのみ反映）

◆ 選考分析（CA向け）
キャリアアドバイザーが選考を進める上で把握すべき現実的な評価を、事実ベースで簡潔に記載。
この内容はマイページには表示されず、CAのみが閲覧する。

【CA向けに含める内容】
- 必須要件の充足状況（大卒要件、経験年数、資格等）。未達項目があれば明示
- 経験・スキルの強みと不足を率直に記載
- 書類選考・面接で想定される懸念点
- 年収・条件面の乖離（固定残業、勤務地、年収レンジ等）
- 企業への推薦時の注意点
- 選考通過のための具体的な戦略・アドバイス

【CA向けの文体ルール】
- 事実ベースで簡潔に
- 「〜が懸念点です」「〜の確認が必要です」「〜でカバーが必要」等、率直な表現で構わない
- 箇条書き可

---

【重要ルール】
- 必ず上記2セクション両方を出力すること。どちらか片方だけでは不可
- 「◆ おすすめポイント（本人向け）」→「◆ 選考分析（CA向け）」の順で記載
- 各セクション内は冗長な説明は不要、結論を先に書く
- 「---」の区切り線で各求人を明確に分離すること

## 重要
- 候補者の経歴情報が不足している場合は、正確な判定はできない旨を明記してください
- 情報が不足している場合でも、求人票の内容は分析し、「候補者情報が不足しているため、求人内容のみの評価です」と前置きしてください
- 推測や仮定で候補者のスキルや経験を補完しないでください`;

  const skillContent = getJobMatchingSkill();
  const SKILL_HEADER = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。
以下の「求人マッチングスキル定義」に基づき、候補者情報と求人票を分析してください。

---

# 求人マッチングスキル定義

${skillContent}

---

`;

  // キャッシュ最適化: 固定部分(skill+評価ルール)を独立ブロック化し cache_control を付与する。
  // 可変部分(バッチ指示)は別ブロックに分離（cache_control なし）。テキスト内容は不変。
  const FIXED_SYSTEM = `${SKILL_HEADER}${EVAL_RULES}`;

  if (isLastBatch) {
    systemPrompt = `# このリクエストの分析タスク

これは全${totalFiles}件中の最後のバッチ（${start + 1}〜${end}件目）です。

## このバッチの分析後、以下の総合まとめを必ず出力すること

最後に以下の形式で総合まとめを出力してください。
ランクごとにセクションを分け、各社は1行ずつ記載し、ランク間には空行を入れること：

━━━━━━━━━━━━━━━━━━━
【総合優先順位（全${totalFiles}件）】
━━━━━━━━━━━━━━━━━━━

■ 総合A（積極的に紹介）

・会社名 — 本人希望:A / 通過率:A
・会社名 — 本人希望:A / 通過率:B

■ 総合B（紹介してよい）

・会社名 — 本人希望:B / 通過率:B
・会社名 — 本人希望:A / 通過率:C

■ 総合C（条件付きで検討）

・会社名 — 本人希望:A / 通過率:D
・会社名 — 本人希望:C / 通過率:B

■ 総合D（紹介非推奨）

・会社名 — 本人希望:D / 通過率:D

- 各ランクのヘッダー（■ 総合A 等）の前後に必ず空行を入れること
- 各社は「・」で始め、1社1行で記載すること（1行に複数社を詰め込まない）
- 該当なしのランクは「該当なし」と記載すること

※これまでのバッチの結果はチャット履歴に含まれています。それを参照して総合まとめを作成してください。`;
  } else {
    systemPrompt = `# このリクエストの分析タスク

これは全${totalFiles}件中の${start + 1}〜${end}件目です。

- このバッチの分析のみ行い、総合まとめは最終バッチで行います
- 「---」の区切り線で各求人を明確に分離すること`;
  }

  // 6. Fetch chat history — 最終バッチ（総合まとめ生成）のみ過去バッチ結果を同梱する。
  //    中間バッチは各求人単体分析に履歴不要のため非同梱（input 削減・質不変）。
  const pastMessages = isLastBatch
    ? (
        await prisma.advisorChatMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: "asc" },
        })
      ).slice(-MAX_PAST_MESSAGES)
    : [];

  const messagesArray = [
    ...pastMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.length > MAX_CHAT_MESSAGE_CHARS
        ? m.content.substring(0, MAX_CHAT_MESSAGE_CHARS) + "\n...（省略）"
        : m.content,
    })),
    {
      role: "user" as const,
      content: `## 候補者情報\n${candidateContext}\n\n## 検討中の求人票（${start + 1}〜${end}件目 / 全${totalFiles}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
    },
  ];

  // 7. Call Anthropic API
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
        model: CLAUDE_MODEL_ANALYSIS,
        max_tokens: 16000,
        temperature: 0.7,
        system: [
          {
            type: "text",
            text: FIXED_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: systemPrompt,
          },
        ],
        messages: messagesArray,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[AnalyzeBatch] Anthropic error:", response.status, errText);
      // T-126: 失敗コールも記録（課金トークンは無いが失敗率の可視化に使う）。
      await recordAdvisorUsage({
        endpoint: "analyze-batch",
        model: CLAUDE_MODEL_ANALYSIS,
        usage: null,
        candidateId,
        batchIndex,
        batchTotal: Math.ceil(totalFiles / batchSize),
        fileCount: batchFiles.length,
        isRetry: mode === "invalid-only",
        note: `error-${response.status}`,
      });
      if (response.status === 429) {
        return NextResponse.json({ error: "APIのレート制限に達しました。少し待ってから再度お試しください。" }, { status: 429 });
      }
      let detail = "";
      try {
        const errJson = JSON.parse(errText);
        detail = errJson?.error?.message || "";
      } catch { /* not JSON */ }
      return NextResponse.json({
        error: `AIからの応答取得に失敗しました（${response.status}${detail ? `: ${detail}` : ""}）`,
      }, { status: 500 });
    }

    const data = await response.json();
    const u = data.usage ?? {};
    console.log(`[analyze-batch usage] input=${u.input_tokens} output=${u.output_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens}`);
    // T-126: usage を永続化。invalid-only は再実行経路なので isRetry=true。
    await recordAdvisorUsage({
      endpoint: "analyze-batch",
      model: CLAUDE_MODEL_ANALYSIS,
      usage: u,
      candidateId,
      batchIndex,
      batchTotal: Math.ceil(totalFiles / batchSize),
      fileCount: batchFiles.length,
      isRetry: mode === "invalid-only",
      note: isLastBatch ? "last-batch" : null,
    });
    const analysisText = data.content?.[0]?.text || "";

    // 8. Save to chat
    const label = isLastBatch
      ? `【求人分析 バッチ${batchIndex + 1}（${start + 1}〜${end}件目）+ 総合まとめ】`
      : `【求人分析 バッチ${batchIndex + 1}（${start + 1}〜${end}件目）】`;

    await prisma.advisorChatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: `ブックマーク求人分析（${start + 1}〜${end}件目 / 全${totalFiles}件）を実行`,
      },
    });

    await prisma.advisorChatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: `${label}\n\n${analysisText}`,
      },
    });

    // 9. Extract ratings + comments and save to CandidateFile
    //    「rating + comment + 3軸マーカー」の3点が揃って初めて DB 反映する。
    //    部分保存（rating だけ / 3軸欠落）は一切行わず、skippedFileIds として返す。
    const ratingsAndComments = extractRatingsAndComments(analysisText, batchFiles);
    const skippedFileIds: string[] = [];
    // batchFiles にあって extraction 結果に載らなかったものも skip として報告
    const extractedIds = new Set(ratingsAndComments.keys());
    for (const f of batchFiles) {
      if (!extractedIds.has(f.id)) skippedFileIds.push(f.id);
    }

    for (const [fileId, { rating, comment }] of ratingsAndComments) {
      try {
        if (!rating || !comment) {
          skippedFileIds.push(fileId);
          console.warn(
            `[AnalyzeBatch] Incomplete data, skipping update: fileId=${fileId} hasRating=${!!rating} hasComment=${!!comment}`
          );
          continue;
        }
        if (!hasValidThreeAxisMarkers(comment)) {
          skippedFileIds.push(fileId);
          console.warn(
            `[AnalyzeBatch] 3軸マーカー欠落により上書きスキップ: fileId=${fileId}, candidateId=${candidateId}, head="${comment.substring(0, 100).replace(/\n/g, " ")}"`
          );
          continue;
        }
        await prisma.candidateFile.update({
          where: { id: fileId },
          data: {
            aiAnalyzedAt: new Date(),
            aiMatchRating: rating,
            aiAnalysisComment: comment,
          },
        });
      } catch (updateErr) {
        skippedFileIds.push(fileId);
        console.error(`[AnalyzeBatch] Update failed for fileId=${fileId}:`, updateErr);
      }
    }

    console.log("[AnalyzeBatch] Extracted ratings:", {
      totalFiles: batchFiles.length,
      extractedCount: ratingsAndComments.size,
      skippedCount: skippedFileIds.length,
      ratings: Object.fromEntries([...ratingsAndComments].map(([id, { rating }]) => [id, rating])),
    });

    return NextResponse.json({
      batchIndex,
      startIndex: start + 1,
      endIndex: end,
      totalFiles: allBookmarks.length,
      isLastBatch: end >= allBookmarks.length,
      analysisText: `${label}\n\n${analysisText}`,
      remainingFiles: allBookmarks.length - end,
      skippedFileIds,
    });
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      console.error("[AnalyzeBatch] Timeout after", API_TIMEOUT_MS, "ms");
      return NextResponse.json({ error: "タイムアウトしました" }, { status: 504 });
    }
    console.error("[AnalyzeBatch] Error:", e);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}

// T-189 Phase 2a: ブックマークAI評価（analyze-batch）の本体を CA セッション非依存の lib に切り出したもの。
//
// 出所: src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts から**そのまま移動**。
// プロンプト文言・出力フォーマット・結果解析・fail-closed 保存ロジックは1文字も変えていない
// （固定プレフィックスが CA 画面経路と byte-identical であることは 1h プロンプトキャッシュの
//   共有条件でもある）。CA 画面経路（analyze-batch route）と自動評価経路
// （/api/internal/recommend/analyze-submit,collect・Message Batches API）の両方がここを呼ぶ。
//
// ここに置くもの:
//   - 固定 system プレフィックス（SKILL_HEADER + EVAL_RULES）の組み立て … buildAnalyzeFixedSystem
//   - 候補者 context の組み立て（評価一覧の除去・20,000字切り詰め）… buildAnalyzeCandidateContext
//   - バッチ指示（system 第3ブロック）… buildBatchInstruction
//   - user 側の求人票セクション組み立て … buildAnalyzeJobsSection
//   - 出力の解析と fail-closed 保存 … extractRatingsAndComments / hasValidThreeAxisMarkers /
//     applyAnalysisResults（rating+comment+3軸マーカーの3点が揃った行のみ保存）
// ここに置かないもの（route 側に残る）:
//   - 総合まとめ（最終バッチ）・完了カード・runContextCache 等の run 制御（CA 画面専用）

import { prisma } from "@/lib/prisma";
import { getCandidateContext, RATINGS_SECTION_MARKER } from "@/lib/advisor-context";
import { getJobMatchingSkill } from "@/lib/load-job-matching-skill";
import { RATING_VALUE } from "@/lib/ai-rating";
import { CA_MARK_CLASS } from "@/lib/ca-analysis-format";
import { extractCompanyNameCandidates } from "@/lib/normalize-filename";

// T-180: 選考分析（CA向け）の項目見出し行「【固定残業】▲」を、求人セクション見出し
// 「【会社名】求人タイトル」と区別するための否定先読み。
// 【…】の直後が「判定記号1文字だけで行末」なら項目行なのでセクション区切りとして扱わない。
const NOT_CA_ITEM = `(?!\\s*${CA_MARK_CLASS}\\s*(?:\\n|$))`;

export function hasValidThreeAxisMarkers(comment: string | null | undefined): boolean {
  if (!comment) return false;
  const c = comment.replace(/\*\*/g, "");
  const hasDesire = new RegExp(`■\\s*本人希望[：:]\\s*${RATING_VALUE}`).test(c);
  const hasPass = new RegExp(`(?:■\\s*)?通過率[：:]\\s*${RATING_VALUE}`).test(c);
  const hasOverall = new RegExp(`(?:■\\s*)?総合[：:]\\s*${RATING_VALUE}`).test(c);
  return hasDesire && hasPass && hasOverall;
}

export function extractRatingsAndComments(
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
      if (new RegExp(`^${RATING_VALUE}$`).test(trimmed)) { currentRating = trimmed; continue; }
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
      // ※ T-180: 選考分析（CA向け）の項目見出し「【固定残業】▲」も空行後の裸【】に見えるため、
      //   NOT_CA_ITEM（記号1文字で行末＝項目行 を否定先読みで除外）を付けないと、
      //   1件目の項目行で求人セクションが打ち切られ選考分析が丸ごと欠落する。
      const afterStart = analysisText.substring(startIndex);
      const nextSection = afterStart
        .slice(1)
        .match(new RegExp(
          `\\n##\\s+【[^】]+】${NOT_CA_ITEM}|\\n\\*\\*\\s*【[^】]+】|\\n\\n【[^】]+】${NOT_CA_ITEM}|\\n(?:###?\\s*)?求人\\d+[：:]|\\n━━━`
        ));
      const endIndex = nextSection
        ? startIndex + 1 + (nextSection.index || afterStart.length)
        : startIndex + Math.min(afterStart.length, 3000);

      const comment = analysisText.substring(startIndex, endIndex).trim();

      if (comment.length > 10) {
        const existing = results.get(file.id);
        if (existing) {
          existing.comment = comment;
        } else {
          const ratingMatch = comment.match(new RegExp(`■\\s*総合[：:]\\s*(${RATING_VALUE})`))
            || comment.match(new RegExp(`総合[：:]\\s*(${RATING_VALUE})`));
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
        const patterns = [
          new RegExp(`■\\s*総合[：:]\\s*(${RATING_VALUE})`),
          new RegExp(`総合[：:]\\s*(${RATING_VALUE})`),
          new RegExp(`評価[：:]\\s*(${RATING_VALUE})`),
          new RegExp(`【(${RATING_VALUE})】`),
        ];
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
  const name = fileName.replace(/\.pdf$/i, "");

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

  // T-146 追加調査: ファイル名に会社名以外の文字（括弧書き・部署名・キャッチコピー・
  // 記号）が混ざると、上のどの候補にも不純物が残り 【会社名】 と照合できずに
  // 評価の保存ごとスキップされる（本番で 105 件・求職者 52 名）。
  // ★必ず末尾に追加する★ — 候補は先頭から順に試され最初の一致で確定するため、
  // 末尾に足す限り現在成功している照合の挙動は変わらない。
  for (const core of extractCompanyNameCandidates(fileName)) {
    if (!expanded.includes(core)) expanded.push(core);
  }

  return expanded;
}

/**
 * 照合用アポストロフィの畳み込み（1文字→1文字・長さ保存）。
 *
 * AI は入力の `’`(U+2019) を `'`(U+0027) に正規化して見出しを書くことがあり、
 * ファイル名側（DB実値）が U+2019 のままだと `【[^】]*会社名[^】]*】` の照合が
 * 必ず MISS して評価の保存ごとスキップされる（本番で 6件・求職者6名が該当）。
 *   例) DB: 求人票_株式会社ＣＯＭ’Ｓ.pdf  ／ AI出力: 【株式会社ＣＯＭ'Ｓ】
 *
 * ★対象は U+2019 / U+FF07 / U+2018 / U+02BC の4種のみ★
 * `` ` ``(U+0060) と `´`(U+00B4) は会社名の区切りとして使われうるため畳まない。
 */
const APOSTROPHE_VARIANTS = /[’＇‘ʼ]/g;

/**
 * Replace full-width spaces with half-width, and unify apostrophe variants,
 * for matching. ★必ず長さ保存（1文字→1文字）であること★
 * normalizedText のインデックスは analysisText にそのまま対応する前提で
 * 本文を substring 切り出ししているため（Phase 2 冒頭のコメント参照）、
 * ここに長さの変わる置換を足すと切り出しが破損する。
 */
function normalizeSpaces(str: string): string {
  return str.replace(/　/g, " ").replace(APOSTROPHE_VARIANTS, "'");
}

function normalizeCompanyName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(/[・]/g, "")
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
}

const MAX_CONTEXT_CHARS = 20000;

const EVAL_RULES = `## 評価ルール

各求人について、以下の3軸で評価を行うこと。**本人希望と通過率は A/B/C/D の4段階、総合は A/B+/B/C/D の5段階**（良い順に A > B+ > B > C > D。B+ は総合にのみ存在し、本人希望・通過率には使用しない）。評価基準は上記の「求人マッチングスキル定義」（特に Phase 5: ABCDマッチング評価）に従う。

### ① 本人希望（求職者の希望・志向性とのマッチ度）
- A: 志向性も条件もほぼ一致。本人が間違いなく応募する求人
- B: 方向性は合っているが、条件が何か足りない
- C: 条件は適しているが、方向性が合っていない
- D: 両方適していない

### ② 通過率（書類選考・面接の通過可能性）

**最初に必ず確認：** 必須要件（学歴・資格・経験年数）の充足チェック。未充足ならD判定（推薦状でカバー可能な場合のみC検討）。スキル定義の Phase 5 軸2 を参照。

**判定手順（2026年8月改訂・必ずこの順で）:**

1. 必須要件（学歴・資格・経験年数）の充足を確認する。未充足なら D で確定（推薦状でカバー可能な場合のみ C）
2. 必須要件を満たす場合、選考分析の各項目（年齢レンジ・経験年数・経験の質・転職回数・年収レンジ・勤務条件・歓迎要件など）に 〇/▲/× を付ける
3. **（選考観点の）▲と×の個数でランクを機械的に決める**。「迷ったらB」は禁止。懸念を数えて必ず A/B/C のどれかに振り分ける

| ランク | 判定条件 |
|---|---|
| A | 必須要件を全て満たし、選考観点の▲・×が0個。年齢・経験年数・転職回数が求人の想定レンジ内 |
| B | 必須要件を満たすが、選考観点の▲が1〜2個ある。×は0個 |
| C | 必須要件は満たすが、選考観点の▲が3個以上、または(必須要件以外に)×が1個以上ある。または必須要件未充足だが推薦状でカバー可能性あり |
| D | 必須要件の充足が不十分（学歴・資格・経験年数のいずれかが未充足） |

**歓迎要件の扱い:** 求人票に歓迎要件の記載があり、本人がそのいずれにも該当しない場合は、選考観点の▲1個として数える(選考分析に【歓迎要件】▲ の項目を立てる)。一部でも該当していれば〇。求人票に歓迎要件の記載がない場合は項目を立てず、数えない。
（閾値の根拠: 実績200件の検証 2026-08-28 T-182 step3 — 選考観点▲0個57.9%/1個61.2%/2個54.2%に対し▲3個以上27.8%・×1個以上36.5%。段差は▲2↔3の間と×の有無にのみある）

**A判定の条件について:** 過去の通過実績・企業の採用温度感は、判定時に分かっている場合のみ「B→A」「A→B」の補正に使う。Aの必須条件ではない。
この補正が使えるのは **A と B の間だけ** である。▲が3個以上ある／×がある求人（＝C）を「経験の親和性が高い」「致命的ではない」等の理由でBへ引き上げてはならない。個数ルールが常に優先する。


**数える対象（重要）:** 通過率に数えるのは「**企業が選考で落とす理由になる** ▲・×」だけである。
- **数える（選考観点）**: 必須要件充足 / 経験・スキル / 経験の質 / 経験年数 / 年齢レンジ / 転職回数 / 求人の想定年収レンジからの逸脱 / 歓迎要件 / 選考難易度
- **数えない（本人希望観点）**: 固定残業が希望より長い / 年間休日が希望より少ない / 通勤距離・勤務地が希望と違う / 職種の好みに合わない / 希望年収に届かない

本人希望観点の懸念は「① 本人希望」で既に評価しているため、通過率に二重計上してはならない（2軸が同じものを測ってしまい、通過率の予測力が失われる）。ただし勤務地・勤務条件でも「物理的に通勤不可能」「シフトが本人の制約と両立不可」など**選考自体が成立しない**水準であれば選考観点として数える。
**判定の甘さの目安:** ランク付き求人のうち通過率Bが5割を超えている状態は、懸念を数えずにBへ逃げている可能性が高い。

**【出力順に関する必須手順】** 「■ 通過率」行は出力上は「◆ 選考分析（CA向け）」より前に来るが、**判定の順序は逆である**。1件の求人を書き始める前に、必ず先に「◆ 選考分析（CA向け）」の全項目と各項目の 〇/▲/× を確定させ、そのうち**選考観点の** ▲ と × の個数を数えてから通過率ランクを決め、「■ 通過率」行を書くこと。ランクを先に決めてから選考分析の記号を後付けで合わせてはならない。出力し終えた時点で、選考分析に実際に付いた選考観点の ▲・× の個数と上表の条件が必ず一致していること（不一致は誤りであり、その場合は選考分析の記号側を正として通過率ランクを直す）。

補足:
- 業務委託・BPO・派遣での経験は、自社運営の経験より書類評価が低くなる傾向
- 35歳以上で未経験業種への応募は書類通過率が大幅に下がる（詳細は付録「ミドル層詳細ガイド」参照）
- 固定残業時間が長い求人（30時間超）は安定志向の求職者にはマイナス評価

### ③ 総合（紹介推奨度）
- A: 積極的に紹介 — 本人希望にも合い、通過も見込める
- B+: 紹介する価値は明確にあるが最優先ではない — 本人希望と通過率のどちらか一方がA、もう一方がB
- B: 紹介してよい — バランスが取れている、または片方が強い
- C: 条件付きで検討 — 紹介するなら補足説明や対策が必要
- D: 紹介非推奨 — 本人にも合わず通過も厳しい

判断材料: ①②を機械的に合成する。**必ずスキル定義 Phase 5「総合評価の算出」テーブルに従うこと。**

| 希望 × 通過 | 総合評価 |
|---|---|
| A × A | 総合A |
| A × B | 総合B+ |
| B × A | 総合B+ |
| A × C〜D | 総合B |
| B × B | 総合B |
| B × C | 総合C |
| B × D | 総合C |
| C × A〜B | 総合C |
| C × C | 総合C |
| C × D | 総合D |
| D × 任意 | 総合D |

**本表は希望×通過の全組み合わせを網羅する。表にない組み合わせは存在しないため、AIが独自に判断してはならない。**

総合評価は「本人の希望に合っているか」を優先して決める。希望に合わない求人は、選考を通過しやすくても本人が応募しないため、良い評価を付けても紹介に結びつかない。したがって希望Aは通過が厳しくてもBを維持し、希望Cは通過が堅くてもCに留める。必須要件未充足（通過率D）の求人が総合A・総合B+ になることはない。

**評価は必ず1つに確定させること。** 総合は A / B+ / B / C / D のいずれか1つ、本人希望と通過率は A / B / C / D のいずれか1つを返す。「A〜B」「B〜C」のような範囲表記、「Bより」「B寄り」「Bに近いC」等の曖昧表現は使用しない。迷った場合も必ず1つに決める。

## 出力フォーマット
各求人の分析コメントは以下のフォーマットで、簡潔に出力してください。求人と求人の間には必ず空行を2行入れて区切ること：

---

【会社名】求人タイトル

■ 本人希望: A / B / C / D のいずれか1つ
■ 通過率: A / B / C / D のいずれか1つ
■ 総合: A / B+ / B / C / D のいずれか1つ

※この3行には評価記号のみを書く。「A〜B」等の範囲表記や補足語を付けないこと。

◆ おすすめポイント（本人向け）
評価ランク（A/B+/B/C/D）に関係なく、すべての求人で「積極的・前向きな推薦コメント」を生成する。
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
- 評価ランクA/B+/B/C/Dの違いは本人向けコメントの文体には反映させない（CA向けにのみ反映）

◆ 選考分析（CA向け）
キャリアアドバイザーが選考を進める上で把握すべき現実的な評価を、事実ベースで簡潔に記載。
この内容はマイページには表示されず、CAのみが閲覧する。

■ 出力形式（必須・T-180）
このセクションは必ず「項目ごとの判定」形式で書くこと。1項目 = 見出し行1行 + コメント行。
項目と項目の間には空行を1行入れる。

書式:

【項目名】記号
（その項目のコメント。1〜3文で簡潔に）

（空行）

【項目名】記号
（コメント）

判定記号は次の3種のみを使う。他の記号（◎ △ ー 等）や記号なしは不可:
- 〇 … 問題なし・要件を満たす・希望と合致
- ▲ … 懸念あり・要確認・条件が一部合わない
- × … 不適合・選考上の大きな障害

書式の絶対ルール:
- 見出し行は「【項目名】記号」だけで完結させ、記号の後ろに文章・句読点・補足を書かない（コメントは必ず次の行）
- 記号は必ず 〇 / ▲ / × のいずれか1文字
- コメントは見出し行の次の行から書く。見出し行と同じ行に続けない
- 項目名は【】で囲む。項目名の中に【】を入れない
- 「- 」等の箇条書き記号でこの見出し行を始めない
- 全体で4〜7項目程度に収める
- **このセクションの ▲・× の個数が「■ 通過率」ランクの根拠である**（評価ルール② の判定手順を参照）。記号は実態に忠実に付け、通過率ランクと整合させること。ただし数えるのは**選考観点の ▲・×**（必須要件・経験・スキル・年齢・転職回数・想定年収レンジ逸脱・歓迎要件・選考難易度）だけで、本人希望観点の ▲・×（固定残業・年間休日・通勤距離・職種の好み・希望年収との差）は通過率には数えない
- **選考分析に「【項目名】記号」以外の【】見出しを作らない**。「【通過率判定根拠】」のような判定理由の独立ブロックを追加してはならない（記号のない【】見出しは求人の区切りとして誤認され、コメントが途中で切れる）。補足したい場合は該当項目のコメント行に書く

項目名は求人ごとに適切なものをAIが立ててよい（固定リストではない）。
典型例: 必須要件充足 / 経験・スキル / 年収 / 固定残業 / 勤務地 / 選考難易度 / 推薦時の注意点 / 志望動機の作り込み

出力例:

【必須要件充足】〇
4大卒〇、ライター職への志望度〇。選考ではライターへの志望度・意欲がメインの確認事項であり、経験・志向と合致。

【年収】〇
300万〜400万円。現年収約300万円からの微増〜上昇が見込める。

【固定残業】▲
45時間が最大の懸念。希望は月11〜15時間。安定志向の求職者にはD評価相当。

【CA向けに含める内容】（上記の項目として立てる）
- 必須要件の充足状況（大卒要件、経験年数、資格等）。未達項目があれば明示
- 経験・スキルの強みと不足を率直に記載
- 書類選考・面接で想定される懸念点
- 年収・条件面の乖離（固定残業、勤務地、年収レンジ等）
- 企業への推薦時の注意点
- 選考通過のための具体的な戦略・アドバイス

【CA向けの文体ルール】
- 事実ベースで簡潔に
- 「〜が懸念点です」「〜の確認が必要です」「〜でカバーが必要」等、率直な表現で構わない

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

/**
 * 固定 system プレフィックス（skill定義＋評価ルール）。候補者・バッチによらず不変で、
 * CA 画面経路・自動評価経路の間でも byte-identical（1h プロンプトキャッシュを共有する）。
 */
export function buildAnalyzeFixedSystem(): string {
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
  return `${SKILL_HEADER}${EVAL_RULES}`;
}

/**
 * バッチ指示（system 第3ブロック・毎バッチ可変）。
 * isLastBatch=true は総合まとめの生成指示付き（CA 画面経路の最終バッチのみ。
 * 自動評価経路は総合まとめを行わないため常に false で呼ぶ）。
 */
export function buildBatchInstruction(params: {
  totalFiles: number;
  start: number;
  end: number;
  isLastBatch: boolean;
}): string {
  const { totalFiles, start, end, isLastBatch } = params;
  let systemPrompt: string;

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

■ 総合B+（紹介する価値は明確だが最優先ではない）

・会社名 — 本人希望:A / 通過率:B
・会社名 — 本人希望:B / 通過率:A

■ 総合B（紹介してよい）

・会社名 — 本人希望:B / 通過率:B
・会社名 — 本人希望:A / 通過率:C

■ 総合C（条件付きで検討）

・会社名 — 本人希望:C / 通過率:B

■ 総合D（紹介非推奨）

・会社名 — 本人希望:D / 通過率:D

- ランクの並び順は 総合A → 総合B+ → 総合B → 総合C → 総合D とすること
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
  return systemPrompt;
}

/**
 * 候補者 context（system 第2ブロック）の組み立て。
 * 評価一覧・ブックマーク求人票セクションの除去と 20,000字切り詰めを含む。
 * 取得失敗時は空文字を返す（呼び出し側でキャッシュ可否を判断する）。
 */
export async function buildAnalyzeCandidateContext(candidateId: string): Promise<string> {
  let candidateContext = "";
  try {
    candidateContext = await getCandidateContext(candidateId);
    // Strip bookmark sections (we send job postings separately)
    // T-163: 評価一覧（RATINGS_SECTION_MARKER）はチャット用のため、評価する側の
    // analyze-batch には見せない（自分の過去評価による判定の自己調整を防ぐ）。
    // 評価一覧 → 求人票テキストの順で並ぶため、早い方の位置から除去する
    // ＝analyze-batch の入力は T-163 以前と byte 同一に保たれる。
    const ratingsIdx = candidateContext.indexOf(RATINGS_SECTION_MARKER);
    const bookmarkIdx = candidateContext.indexOf("## ブックマーク求人票");
    const cutIdx = [ratingsIdx, bookmarkIdx].filter((i) => i !== -1).sort((a, b) => a - b)[0];
    if (cutIdx !== undefined) {
      candidateContext = candidateContext.substring(0, cutIdx).trim();
    }
  } catch (e) {
    console.error("[AnalyzeBatch] Context error:", e);
  }

  // Truncate context to prevent oversized payloads
  if (candidateContext.length > MAX_CONTEXT_CHARS) {
    candidateContext = candidateContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
  }

  return candidateContext;
}

/** user 側の求人票セクション組み立て（DB保存済み extractedText を各3,000字で切り出し）。 */
export function buildAnalyzeJobsSection(
  batchFiles: { fileName: string; extractedText: string | null }[],
  start: number,
): string {
  // 4. Build job posting section for this batch (uses DB-stored extracted text - no PDF binary)
  return batchFiles
    .map((f, i) => {
      const globalIndex = start + i + 1;
      const fullText = f.extractedText || "";
      const text = fullText.substring(0, 3000);
      console.log(`[AnalyzeBatch] Using extracted text: ${f.fileName} (${fullText.length} chars, sent ${text.length})`);
      return `### 求人${globalIndex}: ${f.fileName}\n${text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * AI出力（analysisText）から評価を抽出し、fail-closed で CandidateFile に保存する。
 * 「rating + comment + 3軸マーカー」の3点が揃った行のみ保存し、揃わない行は
 * skippedFileIds として返す（既存値は温存・部分保存しない）。route の step 9 をそのまま移動。
 */
export async function applyAnalysisResults(params: {
  analysisText: string;
  batchFiles: { id: string; fileName: string }[];
  candidateId: string;
  dryRun?: boolean;
}): Promise<{
  ratingsAndComments: Map<string, { rating: string; comment: string }>;
  skippedFileIds: string[];
}> {
  const { analysisText, batchFiles, candidateId, dryRun } = params;
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
      // T-182 dryRun: 精度検証時は評価を DB へ書き戻さない
      //（レスポンスの analysisText だけ返し、既存の評価値は温存する）。
      if (!dryRun) {
        await prisma.candidateFile.update({
          where: { id: fileId },
          data: {
            aiAnalyzedAt: new Date(),
            aiMatchRating: rating,
            aiAnalysisComment: comment,
          },
        });
      }
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

  return { ratingsAndComments, skippedFileIds };
}

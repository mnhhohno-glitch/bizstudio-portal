/**
 * T-XXX step8 第1部: 求人評価のコメントを短くする書き方（新）と今の書き方（旧）の比較テスト。
 *
 * 目的: 出力（費用の約半分）を減らすため、評価コメントの「書き方の指示」だけを短くしたときに、
 *       ランク・▲×の項目数・形式が変わらないかを、本番に保存済みの入力で確かめる。
 *       本番のコード・データは一切変えない検証専用スクリプト。
 *
 * 比べるもの（すべて Opus 5.5・effort low・Message Batches API）:
 *   - 元: job_eval_records に保存済みの結果（本番で実際に出た評価）
 *   - 旧: 保存済みの入力を組み立て直し、今の指示で再実行 → 「旧 vs 元」＝ 5.5 自身のブレ（基準）
 *   - 新: 同じ入力で、指示文のうち「## 出力フォーマット」の部品だけを NEW_OUTPUT_FORMAT に差し替えて実行
 *   - 新2: 不合格時に1回だけ直した指示で再実行（NEW_OUTPUT_FORMAT_V2。旧の結果は使い回す）
 *
 * 入力の組み立て直し（job_eval_parts から）:
 *   - 1回の送信（usage_log_id が同じ行）＝ 1リクエスト。元の送信のまとまり（最大5件）を保つ
 *   - system ①固定部（fixed）②候補者情報（context_core にブックマーク一覧の行を戻したもの）③バッチ指示（instruction）
 *     ②のブックマーク行は保存時に分けられており元の並びは残らないため、「アップロード済みファイル」節の先頭に戻す
 *     （旧・新とも同じ入力なので比較には影響しない）
 *   - user 求人票: 本番と同じ「### 求人N: ファイル名\n本文」。N はバッチ指示の開始位置から振る
 *   - 総合まとめの最終バッチで2バッチ目以降のもの（前のバッチ結果を会話に積む）は、前のバッチ結果が保存されて
 *     いないため載せない（旧・新とも同じ）
 *
 * 本番への影響ゼロの担保:
 *   - DB は default_transaction_read_only=on の接続（起動時に SHOW で確認）
 *   - 評価結果の保存・費用記録（advisor_usage_logs）・job_eval_* への書き込みは呼ばない。
 *     出力の解析は純関数（extractRatingsAndComments / hasValidThreeAxisMarkers / extractAxis / matchCaItemLine）のみ
 *
 * 出力（個人情報を含むためコミットしない・scripts/output/ は .gitignore 済み）: scripts/output/t-xxx-comment-compact/
 *
 * 実行（master worktree・API キーは Railway の環境変数から渡す）:
 *   ANTHROPIC_API_KEY=... npx tsx --env-file=.env scripts/compare-comment-compact-t-xxx.ts <cmd>
 *   cmd: plan / submit old|new|new2 / wait old|new|new2 / tokens old|new|new2 / report [new|new2]
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join("scripts", "output", "t-xxx-comment-compact");
const PLAN_PATH = path.join(OUT_DIR, "plan.json");
const STATE_PATH = path.join(OUT_DIR, "state.json");
const resultsPath = (v: Variant) => path.join(OUT_DIR, `results-${v}.json`);
const tokensPath = (v: Variant) => path.join(OUT_DIR, `tokens-${v}.json`);

const MODEL = "claude-opus-5-5";
const EFFORT = "low";
const MAX_TOKENS = 32000; // 本番（eval-model.ts）と同じ
const TEST_CANDIDATE_ID = "cmmn4jipg00011dqt23w1q3bk"; // 大野テスト（比較対象から外す）
const TARGET_FILES = 60;
const MAX_REQUESTS_PER_CANDIDATE = 2;

// 公式料金表（2026-09-24 取得・step3 と同じ）$/MTok。Batch は半額
const PRICE = { input: 4, output: 20, write5m: 5, write1h: 8, read: 0.2 };
const BATCH_DISCOUNT = 0.5;
const JPY_PER_USD = 157.42; // step1〜 と同じ
const BUDGET_JPY = 800;

type Variant = "old" | "new" | "new2";
const RANKS = ["A", "B+", "B", "C", "D"] as const;
type Rank = (typeof RANKS)[number];
// 総合評価テーブル（本人希望 × 通過率 → 総合）
const TABLE: Record<string, Rank> = {
  AA: "A", AB: "B+", BA: "B+", AC: "B", AD: "B", BB: "B", BC: "C", BD: "C",
  CA: "C", CB: "C", CC: "C", CD: "D", DA: "D", DB: "D", DC: "D", DD: "D",
};

// ---------------------------------------------------------------- 指示文の部品

const FORMAT_START = "## 出力フォーマット\n";
const FORMAT_END = "\n## 重要\n- 候補者の経歴情報";

/**
 * 新しい書き方（第1版）。今の「## 出力フォーマット」節（〜「## 重要」の直前）と差し替える。
 * 変えたのは書き方（長さ・前置きの禁止）だけ。見出し・3軸行・【項目名】記号の形式、▲×の立て方と数え方は変えない。
 */
export const NEW_OUTPUT_FORMAT = `## 出力フォーマット
各求人の分析コメントは以下のフォーマットで、短く出力してください。求人と求人の間には必ず空行を2行入れて区切ること：

---

【会社名】求人タイトル

■ 本人希望: A / B / C / D のいずれか1つ
■ 通過率: A / B / C / D のいずれか1つ
■ 総合: A / B+ / B / C / D のいずれか1つ

※この3行には評価記号のみを書く。「A〜B」等の範囲表記や補足語を付けないこと。

◆ おすすめポイント（本人向け）
評価ランク（A/B+/B/C/D）に関係なく、すべての求人で前向きな推薦の総評を書く。
マイページに表示される内容なので、本人が読んで前向きに応募を検討できる文章にすること。

■ 長さ: 2〜3文（目安3行・150字程度）。求人の魅力と、本人の経験・スキルとの接点を具体的に1つずつ書けば足りる。求人票の条件の羅列はしない

■ 書き方
- 「○○さんの△△の経験は、この求人の□□業務で活かせます」のように具体的に書く
- 完璧に希望と一致しない場合でも、「この点は合致している」「こういう成長機会がある」など前向きな観点を必ず提示する

■ 禁止表現（重要）
PDF記載の希望情報は面談で変化していることが多いため、次の表現は使わない:
- ❌「第1希望」「第2希望」のような希望の順位を特定する表現
- ❌ PDF記載の具体的な希望職種名を「希望職種「XX」」のように引用する表現
- ❌「ご希望の職種と完全一致」「第○希望にぴったり」のような希望と求人を1対1で結びつける断定表現
代わりに「求人の魅力」「本人の経験との接点」を主体に書く（例: 「○○さんが培った××スキルが活きるポジションです」）。

【絶対ルール】
- 求職者名は「○○さん」で統一する。「あなた」は使わない
- 懸念点・確認事項・ネガティブな選考情報は書かない（それらは CA向けセクションに書く）
- 「希望と異なる」「方向性が違う」「軽めにおすすめ」のようなネガティブ表現は使わない
- 評価ランクの違いは本人向けコメントの文体には反映させない（CA向けにのみ反映）

◆ 選考分析（CA向け）
キャリアアドバイザーが選考を進める上で把握すべき現実的な評価を、事実ベースで短く記載。
この内容はマイページには表示されず、CAのみが閲覧する。

■ 出力形式（必須・T-180）
このセクションは必ず「項目ごとの判定」形式で書くこと。1項目 = 見出し行1行 + コメント1行。
項目と項目の間には空行を1行入れる。

書式:

【項目名】記号
（その項目のコメント。短い一文）

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

■ 短く書くときの最優先ルール（項目を減らさない）
短くするのは**各項目のコメントの文だけ**である。項目の立て方と ▲・× の付け方は、短く書かない場合とまったく同じにすること。
- **▲・× の項目は、判定で付けたものを1つ残らず、1項目1行で必ず書く**。複数の懸念を1つの項目にまとめない・省かない・言い換えて数を減らさない
- 〇 の項目も、判定に使ったものは省かない（字数を減らすために項目を削らない）
- 各項目のコメントは結論だけの短い一文にする（目安40字程度）。ただし項目を残すことを字数より優先する
- 求人票の条件や本文を書き写さない（数値は要点だけ）。「※本人希望観点」のような短い補足はコメントの末尾に付けてよい

項目名は求人ごとに適切なものをAIが立ててよい（固定リストではない）。
典型例: 必須要件充足 / 経験・スキル / 年齢・転職回数 / 年収 / 固定残業 / 勤務地 / 歓迎要件 / 選考難易度 / 推薦時の注意点 / 志望動機の作り込み

出力例:

【必須要件充足】〇
4大卒・ライター志望ともに充足。

【経験・スキル】▲
執筆実務は未経験で、ポートフォリオ提出が必要。

【年収】〇
300万〜400万円で、現年収300万円から微増〜上昇。

【固定残業】▲
45時間で希望（月11〜15時間）を大きく超える。※本人希望観点

【CA向けに含める内容】（上記の項目として立てる）
- 必須要件の充足状況（大卒要件、経験年数、資格等）。未達項目があれば明示
- 経験・スキルの強みと不足
- 書類選考・面接で想定される懸念点
- 年収・条件面の乖離（固定残業、勤務地、年収レンジ等）
- 企業への推薦時の注意点・選考通過のための具体的な対策

---

【重要ルール】
- 必ず上記2セクション両方を出力すること。どちらか片方だけでは不可
- 「◆ おすすめポイント（本人向け）」→「◆ 選考分析（CA向け）」の順で記載
- 前置き（「分析します」等）・求人票の書き写し・締めの挨拶やまとめの文は書かない
- 「---」の区切り線で各求人を明確に分離すること
`;

/** 不合格時に1回だけ直す版（第1版で不合格になった場合に原因に合わせて中身を決める）。 */
export const NEW_OUTPUT_FORMAT_V2: string | null = null;

function formatFor(v: Variant): string | null {
  if (v === "old") return null;
  if (v === "new") return NEW_OUTPUT_FORMAT;
  if (!NEW_OUTPUT_FORMAT_V2) throw new Error("NEW_OUTPUT_FORMAT_V2 が未設定");
  return NEW_OUTPUT_FORMAT_V2;
}

/** 固定部（SKILL＋評価ルール＋出力フォーマット）の「## 出力フォーマット」節だけを差し替える。 */
function replaceOutputFormat(fixed: string, format: string): string {
  const s = fixed.indexOf(FORMAT_START);
  const e = fixed.indexOf(FORMAT_END);
  if (s === -1 || e === -1 || e < s) throw new Error("固定部に出力フォーマット節が見つからない");
  return fixed.substring(0, s) + format + fixed.substring(e);
}

// ---------------------------------------------------------------- 共通

type PlanFile = { id: string; fileName: string; origRating: string | null; origComment: string | null };
type PlanGroup = {
  customId: string;
  candidateId: string;
  usageLogId: string;
  route: string;
  fixedHash: string;
  instruction: string;
  context: string;
  userContent: string;
  files: PlanFile[];
};
type Plan = { createdAt: string; fixedOld: string; fixedHash: string; groups: PlanGroup[] };
type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};
type Msg = { content: { type: string; text?: string }[]; usage: Usage; stop_reason: string };
type ResultRow = { customId: string; ok: boolean; error?: string; text: string; usage: Usage; stopReason: string | null };
type State = {
  estimate?: { perRequestUsd: number; variants: number; jpy: number };
  batches?: Partial<Record<Variant, { id: string; submittedAt: string; endedAt?: string }>>;
};

const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, "utf-8")) as T;
const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf-8");
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const jst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
const readState = (): State => (fs.existsSync(STATE_PATH) ? readJson<State>(STATE_PATH) : {});

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 未設定");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 600_000 });
}

function usageUsd(u: Usage): number {
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  return (
    (((u.input_tokens ?? 0) * PRICE.input + w5m * PRICE.write5m + w1h * PRICE.write1h +
      (u.cache_read_input_tokens ?? 0) * PRICE.read + (u.output_tokens ?? 0) * PRICE.output) / 1e6) * BATCH_DISCOUNT
  );
}

async function loadDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未設定（npx tsx --env-file=.env で実行）");
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
  const { prisma } = await import("@/lib/prisma");
  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("SHOW default_transaction_read_only");
  if (ro[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用接続になっていないため中止");
  console.error("default_transaction_read_only=on");
  return prisma;
}

// ---------------------------------------------------------------- plan

async function plan() {
  const prisma = await loadDb();
  // 固定部は本番で実際に送ったもの（job_eval_parts）を使う。ローカルの作業コピーは改行が CRLF になっている
  // ファイルがあり（git の autocrlf）、ここで組み立てると本番と byte 一致しないため。
  // 本番の固定部が1種類しかないこと（＝元の評価がすべて同じ指示で出たこと）を確かめる。
  const fixedRows = await prisma.$queryRawUnsafe<{ fixed_hash: string }[]>(
    `select distinct fixed_hash from job_eval_records where model = $1 and effort = $2`, MODEL, EFFORT);
  if (fixedRows.length !== 1) throw new Error(`固定部が ${fixedRows.length} 種類ある（1種類の前提）`);
  const fixedHash = fixedRows[0].fixed_hash;
  const fixedPart = await prisma.jobEvalPart.findUnique({ where: { hash: fixedHash }, select: { content: true } });
  if (!fixedPart || sha256(fixedPart.content) !== fixedHash) throw new Error("固定部の部品が読めない");
  const fixedOld = fixedPart.content;

  type Row = {
    id: string; candidate_id: string; candidate_file_id: string; status: string; usage_log_id: string; route: string;
    overall_rating: string | null; comment: string | null; fixed_hash: string; instruction_hash: string;
    context_core_hash: string; context_files_hash: string | null; job_hash: string;
  };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `select id, candidate_id, candidate_file_id, status, usage_log_id, route, overall_rating, comment, fixed_hash,
            instruction_hash, context_core_hash, context_files_hash, job_hash
       from job_eval_records
      where model = $1 and effort = $2 and usage_log_id is not null and candidate_id <> $3
        and status in ('SAVED','SKIPPED','FAILED')
      order by created_at, id`,
    MODEL, EFFORT, TEST_CANDIDATE_ID,
  );
  const byLog = new Map<string, Row[]>();
  for (const r of rows) byLog.set(r.usage_log_id, [...(byLog.get(r.usage_log_id) ?? []), r]);
  // 送信の全件が SAVED で、今の固定部と同じもの（＝元と旧が同じ指示で出たもの）だけを候補にする
  const candidates = [...byLog.entries()]
    .filter(([, rs]) => rs.every((r) => r.status === "SAVED" && r.fixed_hash === fixedHash) && rs.length <= 5)
    .map(([log, rs]) => ({ log, rs }));
  console.log(`候補の送信: ${candidates.length}本 / ${candidates.reduce((s, c) => s + c.rs.length, 0)}件`);

  // 選び方: ランクの少ない方（B+・D・A）を多く含む送信を優先し、1人あたり最大2送信・合計60件まで
  const rankCount: Record<string, number> = {};
  for (const c of candidates) for (const r of c.rs) rankCount[r.overall_rating ?? "-"] = (rankCount[r.overall_rating ?? "-"] ?? 0) + 1;
  const rarity = (r: string | null) => 1 / (rankCount[r ?? "-"] ?? 1);
  const scored = candidates
    .map((c) => ({ ...c, score: c.rs.reduce((s, r) => s + rarity(r.overall_rating), 0) / c.rs.length }))
    .sort((a, b) => b.score - a.score || b.rs.length - a.rs.length || a.log.localeCompare(b.log));
  const picked: typeof scored = [];
  const perCand = new Map<string, number>();
  let files = 0;
  for (const c of scored) {
    if (files >= TARGET_FILES) break;
    const cand = c.rs[0].candidate_id;
    if ((perCand.get(cand) ?? 0) >= MAX_REQUESTS_PER_CANDIDATE) continue;
    picked.push(c);
    perCand.set(cand, (perCand.get(cand) ?? 0) + 1);
    files += c.rs.length;
  }
  // 60件に届かなければ 1人あたりの上限を外して足す
  for (const c of scored) {
    if (files >= TARGET_FILES) break;
    if (picked.includes(c)) continue;
    picked.push(c);
    files += c.rs.length;
  }

  // 部品の読み込み
  const hashes = new Set<string>();
  for (const c of picked) for (const r of c.rs) {
    hashes.add(r.instruction_hash); hashes.add(r.context_core_hash); hashes.add(r.job_hash);
    if (r.context_files_hash) hashes.add(r.context_files_hash);
  }
  const parts = await prisma.jobEvalPart.findMany({ where: { hash: { in: [...hashes] } }, select: { hash: true, content: true } });
  const part = new Map(parts.map((p) => [p.hash, p.content]));
  const need = (h: string) => {
    const c = part.get(h);
    if (c === undefined) throw new Error(`部品が見つからない: ${h}`);
    return c;
  };

  const header = "## アップロード済みファイル\n";
  const groups: PlanGroup[] = picked.map((c, gi) => {
    const r0 = c.rs[0];
    const instruction = need(r0.instruction_hash);
    let context = need(r0.context_core_hash);
    if (r0.context_files_hash) {
      const bm = need(r0.context_files_hash);
      const at = context.indexOf(header);
      context = at === -1 ? `${context}\n${header}${bm}\n` : context.substring(0, at + header.length) + bm + "\n" + context.substring(at + header.length);
    }
    const m = instruction.match(/（?(\d+)〜(\d+)件目/);
    const start = m ? Number(m[1]) - 1 : 0;
    const totalM = instruction.match(/全(\d+)件/);
    const total = totalM ? Number(totalM[1]) : c.rs.length;
    const jobs = c.rs.map((r) => need(r.job_hash));
    const jobsSection = jobs.map((body, i) => `### 求人${start + i + 1}: ${body}`).join("\n\n---\n\n");
    const end = start + c.rs.length;
    const userContent = `## 検討中の求人票（${start + 1}〜${end}件目 / 全${total}件）\n${jobsSection}\n\n上記の求人について分析してください。`;
    return {
      customId: `g${String(gi + 1).padStart(2, "0")}`,
      candidateId: r0.candidate_id,
      usageLogId: c.log,
      route: r0.route,
      fixedHash: r0.fixed_hash,
      instruction,
      context,
      userContent,
      files: c.rs.map((r, i) => ({
        id: r.candidate_file_id,
        fileName: jobs[i].split("\n")[0],
        origRating: r.overall_rating,
        origComment: r.comment,
      })),
    };
  });

  const p: Plan = { createdAt: new Date().toISOString(), fixedOld, fixedHash, groups };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJson(PLAN_PATH, p);
  const dist: Record<string, number> = {};
  for (const g of groups) for (const f of g.files) dist[f.origRating ?? "-"] = (dist[f.origRating ?? "-"] ?? 0) + 1;
  console.log(`選んだ送信: ${groups.length}本 / ${groups.reduce((s, g) => s + g.files.length, 0)}件 / 求職者 ${new Set(groups.map((g) => g.candidateId)).size}人`);
  console.log("元の総合ランク分布:", dist);
  // 差し替えが効くことの確認（新の固定部が作れる）
  replaceOutputFormat(fixedOld, NEW_OUTPUT_FORMAT);
  await prisma.$disconnect();
}

// ---------------------------------------------------------------- submit / wait

function requestParams(g: PlanGroup, fixed: string) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    system: [
      { type: "text", text: fixed, cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: `## 候補者情報\n${g.context}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: g.instruction },
    ],
    messages: [{ role: "user", content: g.userContent }],
  };
}

function fixedFor(p: Plan, v: Variant): string {
  const f = formatFor(v);
  return f ? replaceOutputFormat(p.fixedOld, f) : p.fixedOld;
}

async function submit(v: Variant) {
  const p = readJson<Plan>(PLAN_PATH);
  const st = readState();
  if (st.batches?.[v]) throw new Error(`${v} は投入済み: ${st.batches[v]!.id}`);
  const c = client();
  const fixed = fixedFor(p, v);

  // 見積もり（入力はトークン数を実測・キャッシュなし扱い。出力は元の送信の実績 1件 約1,170 トークンに余裕を見て 1,400）
  if (!st.estimate) {
    let inTok = 0;
    for (const g of p.groups) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await c.messages.countTokens({ model: MODEL, system: requestParams(g, fixed).system as any, messages: requestParams(g, fixed).messages as any });
      inTok += r.input_tokens;
    }
    const nFiles = p.groups.reduce((s, g) => s + g.files.length, 0);
    const usd = ((inTok * PRICE.input + nFiles * 1400 * PRICE.output) / 1e6) * BATCH_DISCOUNT;
    st.estimate = { perRequestUsd: usd / p.groups.length, variants: 2, jpy: usd * 2 * JPY_PER_USD };
    console.log(`見積もり: 入力 ${inTok} tok（キャッシュなし扱い）/ 1変種 $${usd.toFixed(2)} ≈ ¥${Math.round(usd * JPY_PER_USD)} / 旧・新の2変種で ≈ ¥${Math.round(st.estimate.jpy)}（新2 は必要時に残りの予算で件数を決める）`);
    if (st.estimate.jpy > BUDGET_JPY - 100) throw new Error("見積もりが上限（動作確認分¥100を残す）を超えるため中止");
  }

  const batch = await c.messages.batches.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requests: p.groups.map((g) => ({ custom_id: `${v}-${g.customId}`, params: requestParams(g, fixed) as any })),
  });
  st.batches = { ...(st.batches ?? {}), [v]: { id: batch.id, submittedAt: jst(new Date()) } };
  writeJson(STATE_PATH, st);
  console.log(`${v}: 投入 ${batch.id}（${p.groups.length}リクエスト）`);
}

async function wait(v: Variant) {
  const st = readState();
  const b = st.batches?.[v];
  if (!b) throw new Error(`${v} は未投入`);
  const c = client();
  for (;;) {
    const s = await c.messages.batches.retrieve(b.id);
    console.log(`${jst(new Date())} ${v} ${s.processing_status} ${JSON.stringify(s.request_counts)}`);
    if (s.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const out: ResultRow[] = [];
  for await (const r of await c.messages.batches.results(b.id)) {
    const res = r.result as unknown as { type: string; message?: Msg; error?: unknown };
    if (res.type === "succeeded" && res.message) {
      const text = res.message.content.filter((x) => x.type === "text").map((x) => x.text ?? "").join("");
      out.push({ customId: r.custom_id.replace(/^[a-z0-9]+-/, ""), ok: true, text, usage: res.message.usage, stopReason: res.message.stop_reason });
    } else {
      out.push({ customId: r.custom_id.replace(/^[a-z0-9]+-/, ""), ok: false, error: JSON.stringify(res), text: "", usage: {}, stopReason: null });
    }
  }
  b.endedAt = jst(new Date());
  writeJson(STATE_PATH, st);
  writeJson(resultsPath(v), out);
  console.log(`${v}: 回収 ${out.length}件（失敗 ${out.filter((x) => !x.ok).length}）`);
}

// ---------------------------------------------------------------- tokens（本文のトークン数を実測）

async function tokens(v: Variant) {
  const res = readJson<ResultRow[]>(resultsPath(v));
  const c = client();
  const base = (await c.messages.countTokens({ model: MODEL, messages: [{ role: "user", content: "." }] })).input_tokens;
  const out: Record<string, number> = {};
  for (const r of res) {
    if (!r.ok) continue;
    const n = (await c.messages.countTokens({ model: MODEL, messages: [{ role: "user", content: `.${r.text}` }] })).input_tokens;
    out[r.customId] = Math.max(0, n - base);
  }
  writeJson(tokensPath(v), out);
  console.log(`${v}: 本文トークン ${Object.values(out).reduce((s, n) => s + n, 0)}（${Object.keys(out).length}件）`);
}

// ---------------------------------------------------------------- report

type Item = { label: string; mark: "ok" | "warn" | "ng" };
type Eval = {
  rating: string | null; desire: string | null; pass: string | null; comment: string;
  items: Item[]; markersOk: boolean; tableOk: boolean; extracted: boolean;
};

function caItems(comment: string, matchCaItemLine: (l: string) => { label: string; mark: "ok" | "warn" | "ng" } | null): Item[] {
  const at = comment.search(/◆\s*選考分析（CA向け）/);
  if (at === -1) return [];
  return comment.substring(at).split("\n").map((l) => matchCaItemLine(l)).filter((x): x is Item => x !== null)
    .map((x) => ({ label: x.label, mark: x.mark }));
}
const warnN = (e: Eval) => e.items.filter((i) => i.mark === "warn").length;
const ngN = (e: Eval) => e.items.filter((i) => i.mark === "ng").length;
const concernCountDiffers = (a: Eval, b: Eval) => warnN(a) !== warnN(b) || ngN(a) !== ngN(b);

/** 項目名の近さ（2文字の組の重なり）。0.34 以上を同じ指摘とみなす */
function bigrams(s: string): Set<string> {
  const t = s.replace(/[・\s／/（）()、]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.substring(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}
function similar(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true;
  const x = bigrams(a), y = bigrams(b);
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return n / Math.max(1, Math.min(x.size, y.size)) >= 0.34;
}
/** a の ▲× 項目のうち、b の ▲× 項目に対応が見つからないもの */
function missingConcerns(a: Eval, b: Eval): Item[] {
  const bc = b.items.filter((i) => i.mark !== "ok");
  return a.items.filter((i) => i.mark !== "ok" && !bc.some((j) => similar(i.label, j.label)));
}

async function report(newVariant: Variant) {
  const ab = await import("@/lib/analyze-bookmarks");
  const { extractAxis } = await import("@/lib/ai-rating");
  const { matchCaItemLine } = await import("@/lib/ca-analysis-format");
  const p = readJson<Plan>(PLAN_PATH);
  const st = readState();
  const resOld = new Map(readJson<ResultRow[]>(resultsPath("old")).map((r) => [r.customId, r]));
  const resNew = new Map(readJson<ResultRow[]>(resultsPath(newVariant)).map((r) => [r.customId, r]));
  const tokOld = fs.existsSync(tokensPath("old")) ? readJson<Record<string, number>>(tokensPath("old")) : {};
  const tokNew = fs.existsSync(tokensPath(newVariant)) ? readJson<Record<string, number>>(tokensPath(newVariant)) : {};

  const toEval = (rating: string | null, comment: string | null, extracted: boolean): Eval => {
    const c = comment ?? "";
    const desire = extractAxis(c, "本人希望");
    const pass = extractAxis(c, "通過率", { requireMarker: false });
    const r = rating ? (rating.match(/^(B\+|[ABCD])/)?.[1] ?? null) : null;
    return {
      rating: r, desire, pass, comment: c, items: caItems(c, matchCaItemLine),
      markersOk: ab.hasValidThreeAxisMarkers(c),
      tableOk: !!(r && desire && pass && TABLE[desire + pass] === r),
      extracted,
    };
  };
  const evalFrom = (res: ResultRow | undefined, g: PlanGroup) => {
    const m = res?.ok ? ab.extractRatingsAndComments(res.text, g.files.map((f) => ({ id: f.id, fileName: f.fileName }))) : new Map();
    return new Map(g.files.map((f) => {
      const x = m.get(f.id);
      return [f.id, toEval(x?.rating ?? null, x?.comment ?? null, !!(x && x.rating && x.comment))];
    }));
  };

  type Row = { g: PlanGroup; f: PlanFile; orig: Eval; old: Eval; neu: Eval };
  const rows: Row[] = [];
  for (const g of p.groups) {
    const eo = evalFrom(resOld.get(g.customId), g);
    const en = evalFrom(resNew.get(g.customId), g);
    for (const f of g.files) {
      rows.push({ g, f, orig: toEval(f.origRating, f.origComment, true), old: eo.get(f.id)!, neu: en.get(f.id)! });
    }
  }
  const N = rows.length;
  const same = (a: Eval, b: Eval) => a.rating !== null && a.rating === b.rating;
  const rankNO = rows.filter((r) => same(r.neu, r.old)).length;
  const rankOE = rows.filter((r) => same(r.old, r.orig)).length;
  const rankNE = rows.filter((r) => same(r.neu, r.orig)).length;
  const cntNO = rows.filter((r) => concernCountDiffers(r.neu, r.old)).length;
  const cntOE = rows.filter((r) => concernCountDiffers(r.old, r.orig)).length;
  const passNO = rows.filter((r) => r.neu.pass !== r.old.pass).length;
  const passOE = rows.filter((r) => r.old.pass !== r.orig.pass).length;
  const missNO = rows.flatMap((r) => missingConcerns(r.old, r.neu).map((i) => ({ r, i })));
  const missOE = rows.flatMap((r) => missingConcerns(r.orig, r.old).map((i) => ({ r, i })));
  const warnSum = (k: "orig" | "old" | "neu") => rows.reduce((s, r) => s + warnN(r[k]), 0);
  const ngSum = (k: "orig" | "old" | "neu") => rows.reduce((s, r) => s + ngN(r[k]), 0);
  const itemSum = (k: "orig" | "old" | "neu") => rows.reduce((s, r) => s + r[k].items.length, 0);
  const broken = (k: "old" | "neu") => rows.filter((r) => !r[k].extracted || !r[k].markersOk || !r[k].tableOk || r[k].items.length === 0);

  const sumUsage = (m: Map<string, ResultRow>) => {
    let out = 0, usd = 0;
    for (const r of m.values()) { out += r.usage.output_tokens ?? 0; usd += usageUsd(r.usage); }
    return { out, usd };
  };
  const uo = sumUsage(resOld), un = sumUsage(resNew);
  const bodyO = Object.values(tokOld).reduce((s, n) => s + n, 0);
  const bodyN = Object.values(tokNew).reduce((s, n) => s + n, 0);
  const cut = (a: number, b: number) => (a === 0 ? "-" : `${(((a - b) / a) * 100).toFixed(1)}%`);
  const commentLen = (k: "orig" | "old" | "neu") => Math.round(rows.reduce((s, r) => s + r[k].comment.length, 0) / N);
  const cfLen = (k: "orig" | "old" | "neu") => {
    const xs = rows.map((r) => {
      const c = r[k].comment;
      const a = c.search(/◆\s*おすすめポイント（本人向け）/), b = c.search(/◆\s*選考分析（CA向け）/);
      return a !== -1 && b > a ? c.substring(a, b).replace(/◆\s*おすすめポイント（本人向け）/, "").trim().length : 0;
    });
    return Math.round(xs.reduce((s, n) => s + n, 0) / N);
  };
  const itemLen = (k: "old" | "neu") => {
    const lens: number[] = [];
    for (const r of rows) {
      const lines = r[k].comment.split("\n");
      lines.forEach((l, i) => { if (matchCaItemLine(l) && lines[i + 1]?.trim()) lens.push(lines[i + 1].trim().length); });
    }
    lens.sort((a, b) => a - b);
    return { avg: Math.round(lens.reduce((s, n) => s + n, 0) / Math.max(1, lens.length)), p90: lens[Math.floor(lens.length * 0.9)] ?? 0, max: lens[lens.length - 1] ?? 0 };
  };

  // 合格条件
  const c1 = (rankOE - rankNO) / N * 100 <= 5;
  const c2 = (cntNO - cntOE) / N * 100 < 5;
  const c3 = broken("neu").length === 0;
  const bodyCut = bodyO > 0 ? (bodyO - bodyN) / bodyO : 0;
  const c4 = bodyCut >= 0.25;

  const lines: string[] = [];
  const L = (s = "") => lines.push(s);
  L(`# 比較結果（旧 vs ${newVariant}）`);
  L();
  L(`対象: ${p.groups.length}送信 / ${N}件 / 求職者 ${new Set(p.groups.map((g) => g.candidateId)).size}人（plan ${p.createdAt}）`);
  const dist = (k: "orig" | "old" | "neu") => RANKS.map((x) => `${x}:${rows.filter((r) => r[k].rating === x).length}`).join(" ") + ` 取れず:${rows.filter((r) => !r[k].rating).length}`;
  L(`- 総合ランク分布 元 ${dist("orig")} / 旧 ${dist("old")} / 新 ${dist("neu")}`);
  L();
  L("| 見るもの | 新 vs 旧 | 旧 vs 元（基準＝5.5のブレ） | 新 vs 元 |");
  L("|--|--|--|--|");
  L(`| 総合ランクの完全一致 | ${rankNO}/${N}（${pct(rankNO, N)}） | ${rankOE}/${N}（${pct(rankOE, N)}） | ${rankNE}/${N}（${pct(rankNE, N)}） |`);
  L(`| ▲または×の数が違う求人 | ${cntNO}/${N}（${pct(cntNO, N)}） | ${cntOE}/${N}（${pct(cntOE, N)}） | - |`);
  L(`| 通過率ランクが違う求人 | ${passNO}/${N}（${pct(passNO, N)}） | ${passOE}/${N}（${pct(passOE, N)}） | - |`);
  L(`| 前にあって後に無い▲×の指摘 | ${missNO.length}件 | ${missOE.length}件 | - |`);
  L();
  L(`| 件数の合計 | 元 | 旧 | 新 |`);
  L("|--|--|--|--|");
  L(`| 項目（【】記号行） | ${itemSum("orig")} | ${itemSum("old")} | ${itemSum("neu")} |`);
  L(`| ▲ | ${warnSum("orig")} | ${warnSum("old")} | ${warnSum("neu")} |`);
  L(`| × | ${ngSum("orig")} | ${ngSum("old")} | ${ngSum("neu")} |`);
  L(`| コメント平均字数 | ${commentLen("orig")} | ${commentLen("old")} | ${commentLen("neu")} |`);
  L(`| うち本人向け平均字数 | ${cfLen("orig")} | ${cfLen("old")} | ${cfLen("neu")} |`);
  const io = itemLen("old"), inew = itemLen("neu");
  L(`| CA項目コメント字数 平均/p90/最大 | - | ${io.avg}/${io.p90}/${io.max} | ${inew.avg}/${inew.p90}/${inew.max} |`);
  L();
  L(`表の破り・形式崩れ: 旧 ${broken("old").length}件 / 新 ${broken("neu").length}件（取り出し不可・3軸マーカー欠落・総合評価表との食い違い・項目行0 のいずれか）`);
  for (const r of broken("neu")) L(`- 新 ${r.g.customId} ${r.f.id}: extracted=${r.neu.extracted} markers=${r.neu.markersOk} table=${r.neu.tableOk}(${r.neu.desire}×${r.neu.pass}→${r.neu.rating}) items=${r.neu.items.length}`);
  for (const r of broken("old")) L(`- 旧 ${r.g.customId} ${r.f.id}: extracted=${r.old.extracted} markers=${r.old.markersOk} table=${r.old.tableOk}(${r.old.desire}×${r.old.pass}→${r.old.rating}) items=${r.old.items.length}`);
  L();
  L("| 出力 | 旧 | 新 | 減り方 |");
  L("|--|--|--|--|");
  L(`| 出力トークン合計 | ${uo.out} | ${un.out} | ${cut(uo.out, un.out)} |`);
  L(`| うち本文（実測） | ${bodyO} | ${bodyN} | ${cut(bodyO, bodyN)} |`);
  L(`| うち思考（差し引き） | ${uo.out - bodyO} | ${un.out - bodyN} | ${cut(uo.out - bodyO, un.out - bodyN)} |`);
  L(`| 1件あたり出力トークン | ${Math.round(uo.out / N)} | ${Math.round(un.out / N)} | |`);
  L(`| 費用合計（Batch 半額） | $${uo.usd.toFixed(3)} | $${un.usd.toFixed(3)} | ${cut(uo.usd, un.usd)} |`);
  L(`| 1件あたり費用（Batch 半額） | ¥${((uo.usd / N) * JPY_PER_USD).toFixed(2)} | ¥${((un.usd / N) * JPY_PER_USD).toFixed(2)} | |`);
  L(`| 1件あたり費用（通常送信換算＝×2） | ¥${((uo.usd * 2 / N) * JPY_PER_USD).toFixed(2)} | ¥${((un.usd * 2 / N) * JPY_PER_USD).toFixed(2)} | |`);
  L(`| 1件あたり出力費用（通常送信換算） | ¥${((uo.out * PRICE.output / 1e6 / N) * JPY_PER_USD).toFixed(2)} | ¥${((un.out * PRICE.output / 1e6 / N) * JPY_PER_USD).toFixed(2)} | |`);
  L();
  L("合格条件:");
  L(`1. 新-旧 一致率が 旧-元 から5pt以内: ${pct(rankNO, N)} vs ${pct(rankOE, N)} → ${c1 ? "OK" : "NG"}`);
  L(`2. ▲×数が違う割合 新-旧 が 旧-元 +5pt 未満: ${pct(cntNO, N)} vs ${pct(cntOE, N)} → ${c2 ? "OK" : "NG"}`);
  L(`3. 表の破り・形式崩れ 0件: ${broken("neu").length}件 → ${c3 ? "OK" : "NG"}`);
  L(`4. 本文の出力トークン25%以上減: ${(bodyCut * 100).toFixed(1)}% → ${c4 ? "OK" : "NG"}`);
  L(`判定: **${c1 && c2 && c3 && c4 ? "合格" : "不合格"}**`);
  L();
  L("ランクが動いた件（新 vs 旧）:");
  for (const r of rows.filter((r) => !same(r.neu, r.old))) {
    L(`- ${r.g.customId} ${r.f.id}: 元 ${r.orig.rating}(${r.orig.desire}×${r.orig.pass}) / 旧 ${r.old.rating}(${r.old.desire}×${r.old.pass}) ▲${warnN(r.old)}×${ngN(r.old)} / 新 ${r.neu.rating}(${r.neu.desire}×${r.neu.pass}) ▲${warnN(r.neu)}×${ngN(r.neu)}`);
  }
  L();
  L("旧にあって新に無い▲×の指摘（項目名の近さで対応付け。名前の付け替えも含む）:");
  for (const { r, i } of missNO) {
    L(`- ${r.g.customId} ${r.f.id}: 旧【${i.label}】${i.mark === "warn" ? "▲" : "×"} → 新の▲×: ${r.neu.items.filter((x) => x.mark !== "ok").map((x) => `【${x.label}】${x.mark === "warn" ? "▲" : "×"}`).join(" ") || "なし"} / 新の〇: ${r.neu.items.filter((x) => x.mark === "ok").map((x) => x.label).join("・")}`);
  }
  L();
  L(`実行: ${JSON.stringify(st.batches)}`);
  const md = lines.join("\n");
  fs.writeFileSync(path.join(OUT_DIR, `report-${newVariant}.md`), md, "utf-8");
  console.log(md);

  // 明細 CSV（個人情報を含む・コミットしない）
  const csv = [["group", "candidateId", "fileId", "fileName", "orig", "old", "new", "origAxes", "oldAxes", "newAxes", "orig▲", "orig×", "old▲", "old×", "new▲", "new×", "oldLen", "newLen", "newOk"].join(",")];
  for (const r of rows) {
    csv.push([r.g.customId, r.g.candidateId, r.f.id, `"${r.f.fileName.replace(/"/g, '""')}"`, r.orig.rating, r.old.rating, r.neu.rating,
      `${r.orig.desire}${r.orig.pass}`, `${r.old.desire}${r.old.pass}`, `${r.neu.desire}${r.neu.pass}`,
      warnN(r.orig), ngN(r.orig), warnN(r.old), ngN(r.old), warnN(r.neu), ngN(r.neu), r.old.comment.length, r.neu.comment.length,
      r.neu.extracted && r.neu.markersOk && r.neu.tableOk].join(","));
  }
  fs.writeFileSync(path.join(OUT_DIR, `detail-${newVariant}.csv`), "﻿" + csv.join("\n"), "utf-8");

  // 読み比べ HTML（ランク・項目数がずれた件を優先して10件）
  const prio = [...rows].sort((a, b) => {
    const s = (r: Row) => (!same(r.neu, r.old) ? 2 : 0) + (concernCountDiffers(r.neu, r.old) ? 1 : 0) + (missingConcerns(r.old, r.neu).length > 0 ? 1 : 0);
    return s(b) - s(a);
  }).slice(0, 10);
  const card = (title: string, e: Eval) =>
    `<div class="col"><h3>${title} <span class="r">${e.rating ?? "?"}</span> <small>希望${e.desire ?? "?"}×通過${e.pass ?? "?"} ▲${warnN(e)} ×${ngN(e)} ${e.comment.length}字</small></h3><pre>${esc(e.comment)}</pre></div>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>評価コメント新旧</title>
<style>:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ddd;--card:#fafafa}@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mut:#aaa;--bd:#333;--card:#1f1f1f}}
body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;margin:0;padding:16px}h2{font-size:15px;border-top:2px solid var(--bd);padding-top:12px}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.col{background:var(--card);border:1px solid var(--bd);border-radius:6px;padding:8px}
h3{font-size:13px;margin:0 0 6px}.r{font-weight:700}small{color:var(--mut);font-weight:400}pre{white-space:pre-wrap;font-size:12px;line-height:1.5;margin:0}</style></head><body>
<h1 style="font-size:18px">評価コメント 新旧比較（${prio.length}件・ランクや項目数がずれた件を優先）</h1>
${prio.map((r) => `<h2>${r.g.customId} ${esc(r.f.fileName)}</h2><div class="row">${card("元", r.orig)}${card("旧", r.old)}${card("新", r.neu)}</div>`).join("\n")}
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, `compare-${newVariant}.html`), html, "utf-8");
  console.log(`\n明細: ${path.join(OUT_DIR, `detail-${newVariant}.csv`)} / HTML: ${path.join(OUT_DIR, `compare-${newVariant}.html`)}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const v = (arg ?? "new") as Variant;
  if (cmd === "plan") await plan();
  else if (cmd === "submit") await submit(v);
  else if (cmd === "wait") await wait(v);
  else if (cmd === "tokens") await tokens(v);
  else if (cmd === "report") await report(v === "old" ? "new" : v);
  else throw new Error("cmd: plan / submit <v> / wait <v> / tokens <v> / report [new|new2]");
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

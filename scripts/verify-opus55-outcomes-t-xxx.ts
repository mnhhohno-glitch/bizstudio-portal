/**
 * T-XXX step4 第1部: 求人評価の「通過率の読み」を実際の書類選考の結果で答え合わせする（Opus 4.6 vs Opus 5.5 low / medium）。
 *
 * 目的: step3 の一致率は「Opus 4.6 を正解」とみなした比較だった。ここでは、実際に書類選考の結果が出た求人を使い、
 *       通過率を A/B と付けた求人と C/D と付けた求人の実際の通過率の「差」でモデルを比べる。
 *
 * 対象:
 *   - 5段階評価（T-146, 2026-07-29〜）以降に Opus 4.6 が評価済み（aiAnalyzedAt）のブックマークで、
 *     その評価より後に作られた JobEntry があり、書類選考の結果が出たもの。
 *   - ブックマーク⇔エントリーの紐付け: 同じ求職者で externalJobRef 一致 または kyuujinJobId=externalJobId 一致。
 *     どちらも無い場合だけ、会社名がファイル名に含まれるブックマークが1件に決まるときに限り紐付ける。
 *   - 結果の判定（src/lib/constants/entry-flag-rules.ts の段階・詳細の語彙に従う）:
 *       通過   = entryFlag が 面接 / 内定 / 入社済（書類選考より先へ進んだ）
 *       不合格 = entryFlag が 求人紹介 / エントリー / 書類選考 のまま、entryFlagDetail が 選考落ち / 書類見送り、書類通過日なし
 *       それ以外（本人辞退・クローズ・選考中など）は結果なしとして対象外
 *   - 通過・不合格 各50件まで。1求職者あたり最大8件。
 *
 * 入力（答えが混ざらないようにする）:
 *   本番の候補者情報（src/lib/advisor-context.ts getCandidateContext → analyze-bookmarks buildAnalyzeCandidateContext）を、
 *   Opus 4.6 が評価した時刻 T の状態に戻して組み立て直す（このスクリプト内で同じ組み方を再現。lib は変えない）。
 *     - CAメモ・ファイル一覧・主要書類・応募履歴: T より後に作られたものは入れない
 *     - 応募履歴: T より後に更新された行は、T 時点の状態が分からないため、その求人ごと対象から外す（下記）
 *     - 年齢: T 時点で計算
 *   T 時点の状態に戻せないもの（→ その求人は対象外にし、理由ごとに数える）:
 *     - 面談ログ要約（advisorLogDigest）が T より後に更新された（上書き保存で過去版が残らない）
 *     - 面談ガイド（ワークシート・職務経歴書解析等）が T より後に更新された
 *     - T 以前の CAメモが T より後に編集された
 *     - T 以前に作られた応募履歴の行が T より後に更新された（選考段階・結果が T 時点と違う可能性）
 *     - T 時点の主要書類に未解析のものがある（本番は読み取りを走らせる＝ここでは再現しない）
 *     - エントリー自体が T 以前に作られていた（評価時点で選考が始まっていた）
 *   答えの混入チェック: 組み立てた候補者情報に、その求人のエントリー行が含まれていないこと
 *     （エントリー行 ID の除外・応募履歴節に会社名が出ないこと・候補者情報全体の会社名出現箇所）を全件で確かめて記録する。
 *   組み方の再現チェック: T 以降に何も変わっていない求職者について、T=今 で組んだ結果が本番 lib の出力と一致するかを確かめる。
 *
 * 走らせ方:
 *   - Opus 4.6: 保存済みの過去の評価（aiAnalysisComment）をそのまま使う（再実行しない）
 *   - Opus 5.5: effort low / medium の2設定を Message Batches API（半額）で。ほかは本番と同じ（max_tokens 16000・同じ system/messages）。
 *     temperature と thinking 無効化は 400 のため送らない。応答は text ブロックを連結して読む。
 *   - 応答時間: medium だけ、同じ求職者の2リクエスト（約10件）を通常の送り方（非ストリーミング）で送る。
 *   - AI 費用の上限 ¥1,500。見積もりが超える場合は、リクエストを減らして収める。
 *
 * 本番への影響ゼロの担保:
 *   - DB は default_transaction_read_only=on を付けた接続（起動時に SHOW で確認）。
 *   - 評価結果の保存・recordAdvisorUsage・advisor_chat_messages は呼ばない。出力解析は純関数のみ。
 *
 * 出力（個人情報を含むためコミットしない・scripts/output/ は .gitignore 済み）: scripts/output/t-xxx-opus55-outcomes/
 *
 * 実行（master worktree）:
 *   ANTHROPIC_API_KEY=... npx tsx --env-file=.env scripts/verify-opus55-outcomes-t-xxx.ts <plan|submit|latency|wait|report>
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join("scripts", "output", "t-xxx-opus55-outcomes");
const PLAN_PATH = path.join(OUT_DIR, "plan.json");
const STATE_PATH = path.join(OUT_DIR, "state.json");
const RESULTS_PATH = path.join(OUT_DIR, "results.json");
const LATENCY_PATH = path.join(OUT_DIR, "latency.json");

// T-146 の5段階化が master に揃った日時（step1 と同じ）
const T146_DONE_AT = new Date("2026-07-29T00:23:20+09:00");
const PER_OUTCOME = 50;
const MAX_PER_CANDIDATE = 8;
const BATCH_SIZE = 5;
const MAX_CONTEXT_CHARS = 20000; // analyze-bookmarks.ts と同じ
const MEETING_TEXT_MAX_CHARS = 8000; // advisor-context.ts と同じ

const MODEL_46 = "claude-opus-4-6";
const MODEL_55 = "claude-opus-5-5";
const EFFORTS = ["low", "medium"] as const;
type Effort = (typeof EFFORTS)[number];

// 公式料金（$/MTok）。Opus 5.5: 入力 $4・出力 $20・5分書込 1.25x・1時間書込 2x・読込 0.05x。Batch は 50% 引き。
type Price = { input: number; output: number; write5m: number; write1h: number; read: number };
const PRICES: Record<string, Price> = {
  [MODEL_46]: { input: 5, output: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  [MODEL_55]: { input: 4, output: 20, write5m: 5, write1h: 8, read: 0.2 },
};
const BATCH_DISCOUNT = 0.5;
const JPY_PER_USD = 157.42; // step1〜3 と同じ
const BUDGET_JPY = 1500;
// 見積もりは「キャッシュ読込ゼロ（全リクエストが書込）」の最悪値で出すため、上限そのものに合わせる
const BUDGET_SAFETY = 1.0;
// 1件あたり出力の見積もり（step3 実測: low は 1,116/件。medium は考える工程が増える分を安全側に置く）
const EST_OUTPUT_PER_FILE: Record<Effort, number> = { low: 1300, medium: 2400 };
// Opus 4.6 の1件あたり費用（step1 実測・Batch）。通常の送り方の本番実績は step3 の ¥9.19（総合まとめ込み）
const OPUS46_JPY_PER_FILE_BATCH = 5.34;

const RANKS = ["A", "B+", "B", "C", "D"] as const;
type Rank = (typeof RANKS)[number];
const TABLE: Record<string, Rank> = {
  AA: "A", AB: "B+", BA: "B+", AC: "B", AD: "B", BB: "B", BC: "C", BD: "C",
  CA: "C", CB: "C", CC: "C", CD: "D", DA: "D", DB: "D", DC: "D", DD: "D",
};

type Outcome = "PASS" | "FAIL";

type PlanFile = {
  id: string;
  candidateId: string;
  fileName: string;
  evaluatedAt: string; // T（Opus 4.6 の評価時刻）
  entryId: string;
  entryCreatedAt: string;
  linkBy: "ref" | "kyuujinJobId" | "name";
  outcome: Outcome;
  entryFlag: string;
  entryFlagDetail: string | null;
  past: { rating: string; comment: string };
  leak: { entryRowIncluded: boolean; companyInEntries: boolean; companyMentions: Record<string, number> };
};
type PlanGroup = {
  customId: string;
  candidateId: string;
  fileIds: string[];
  system: unknown[];
  messages: { role: "user"; content: string }[];
  inputTokens?: number;
};
type Plan = {
  createdAt: string;
  since: string;
  files: PlanFile[];
  groups: PlanGroup[];
  funnel: Record<string, number>;
  excluded: Record<string, number>;
  excludedByOutcome: Record<string, Record<string, number>>;
  reproCheck: { candidates: number; identical: number; diffs: string[] };
};
type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};
type Msg = { content: { type: string; text?: string }[]; usage: Usage; stop_reason: string };
type BatchResult = { type: string; message?: Msg };
type LatencyRow = { customId: string; ms: number; usage: Usage; stop_reason: string; text: string };
type State = {
  estimate?: { jpy: Record<string, number>; jpyTotal: number; droppedRequests: string[] };
  sendGroups?: string[];
  batches?: Partial<Record<Effort, string>>;
  submittedAt?: string;
  endedAt?: string;
};

const jst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, "utf-8")) as T;
const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf-8");
const readState = (): State => (fs.existsSync(STATE_PATH) ? readJson<State>(STATE_PATH) : {});
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
function headRank(raw: string | null | undefined): Rank | null {
  const m = (raw ?? "").trim().match(/^(B\+|[ABCD])/);
  return m ? (m[1] as Rank) : null;
}
const normCompany = (s: string) =>
  s.replace(/株式会社|（株）|\(株\)|有限会社|合同会社|[\s　・]/g, "").toLowerCase();

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 未設定");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 600_000 });
}

async function loadLibs() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未設定（npx tsx --env-file=.env で実行）");
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
  const { prisma } = await import("@/lib/prisma");
  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("SHOW default_transaction_read_only");
  if (ro[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用接続になっていないため中止");
  console.log("[db] default_transaction_read_only=on を確認");
  const ab = await import("@/lib/analyze-bookmarks");
  const cache = await import("@/lib/analyze-batch-cache");
  const cat = await import("@/lib/constants/candidate-file-categories");
  return { prisma, ab, cache, cat };
}
type Libs = Awaited<ReturnType<typeof loadLibs>>;

function outcomeOf(e: { entryFlag: string | null; entryFlagDetail: string | null; documentPassDate: Date | null }): Outcome | null {
  if (e.entryFlag && ["面接", "内定", "入社済"].includes(e.entryFlag)) return "PASS";
  if (
    e.entryFlag && ["求人紹介", "エントリー", "書類選考"].includes(e.entryFlag) &&
    e.entryFlagDetail && ["選考落ち", "書類見送り"].includes(e.entryFlagDetail) &&
    !e.documentPassDate
  ) return "FAIL";
  return null;
}

// ---------------------------------------------------------------- 時点復元つき候補者情報

type CandidateData = Awaited<ReturnType<typeof loadCandidateData>>;

async function loadCandidateData(libs: Libs, candidateId: string) {
  const { prisma } = libs;
  const [candidate, guideEntry, notes, files, entries] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: candidateId }, include: { employee: { select: { name: true } } } }),
    prisma.guideEntry.findFirst({ where: { candidateId, guideType: "INTERVIEW" } }),
    prisma.candidateNote.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    prisma.candidateFile.findMany({
      where: { candidateId },
      select: {
        id: true, category: true, fileName: true, createdAt: true, mimeType: true, driveFileId: true, parsedText: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.jobEntry.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, companyName: true, jobTitle: true, status: true, entryFlag: true, entryFlagDetail: true,
        documentSubmitDate: true, documentPassDate: true, firstInterviewDate: true, finalInterviewDate: true,
        offerDate: true, acceptanceDate: true, joinDate: true, createdAt: true, updatedAt: true,
      },
    }),
  ]);
  if (!candidate) throw new Error(`candidate not found: ${candidateId}`);
  return { candidate, guideEntry, notes, files, entries };
}

/** T 時点へ戻せない理由（空なら戻せる） */
function unrestorableReasons(d: CandidateData, T: Date, targetEntryId: string): string[] {
  const r: string[] = [];
  if (d.candidate.advisorLogDigestUpdatedAt && d.candidate.advisorLogDigestUpdatedAt > T) r.push("面談ログ要約が評価後に更新");
  if (d.guideEntry && d.guideEntry.updatedAt > T) r.push("面談ガイドが評価後に更新");
  if (d.notes.some((n) => n.createdAt <= T && n.updatedAt > T)) r.push("CAメモが評価後に編集");
  if (d.entries.some((e) => e.id !== targetEntryId && e.createdAt <= T && e.updatedAt > T)) r.push("評価前の応募履歴が評価後に更新");
  const hasDigest = !!d.candidate.advisorLogDigest?.trim();
  const keyFiles = keyFilesAt(d, T, hasDigest);
  if (keyFiles.some((f) => f.driveFileId && !(f.parsedText ?? "").trim())) r.push("主要書類が未解析");
  return r;
}

function keyFilesAt(d: CandidateData, T: Date, hasDigest: boolean) {
  return d.files
    .filter(
      (f) =>
        f.createdAt <= T &&
        ["ORIGINAL", "BS_DOCUMENT", "MEETING"].includes(f.category) &&
        ["application/pdf", "text/plain"].includes(f.mimeType ?? "") &&
        !(hasDigest && f.category === "MEETING" && f.mimeType === "text/plain"),
    )
    .slice(0, 4);
}

/**
 * getCandidateContext（src/lib/advisor-context.ts）の組み方を T 時点のデータで再現し、
 * buildAnalyzeCandidateContext と同じく評価一覧・ブックマーク求人票の節を含めず 20,000 字で切る。
 * excludeEntryId: 念のため、答え合わせ対象のエントリー行は T 以前でも入れない。
 */
function buildContextAt(libs: Libs, d: CandidateData, T: Date, excludeEntryIds: Set<string>): { text: string; entryIds: string[] } {
  const { candidate, guideEntry } = d;
  const label = libs.cat.getCategoryLabel;
  const guideData = (guideEntry?.data ?? {}) as Record<string, unknown>;
  let context = "";
  context += `## 求職者の基本情報\n`;
  context += `- 氏名: ${candidate.name}\n`;
  context += `- ID: ${candidate.candidateNumber}\n`;
  if (candidate.email) context += `- メール: ${candidate.email}\n`;
  if (candidate.birthday) {
    const age = Math.floor((T.getTime() - new Date(candidate.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    context += `- 生年月日: ${new Date(candidate.birthday).toISOString().slice(0, 10)}\n`;
    context += `- 年齢: ${age}歳\n`;
  }
  if (candidate.gender) context += `- 性別: ${candidate.gender === "male" ? "男性" : candidate.gender === "female" ? "女性" : "その他"}\n`;
  context += `- 担当CA: ${candidate.employee?.name || "未設定"}\n`;
  context += `- 登録日: ${candidate.createdAt.toISOString().slice(0, 10)}\n\n`;

  const hasLogDigest = !!candidate.advisorLogDigest?.trim();
  if (hasLogDigest) {
    const digestDate = candidate.advisorLogDigestUpdatedAt
      ? candidate.advisorLogDigestUpdatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
      : "";
    context += `## 面談内容の要約（取り込み済みの面談ログより${digestDate ? `・${digestDate}更新` : ""}）\n`;
    context += `${candidate.advisorLogDigest!.trim()}\n\n`;
  }

  const ws1 = guideData.worksheet_q1, ws2 = guideData.worksheet_q2, ws3 = guideData.worksheet_q3;
  if (ws1 || ws2 || ws3) {
    context += `## 転職軸ワークシート\n`;
    if (ws1) context += `### なぜ転職するのか？\n${ws1}\n\n`;
    if (ws2) context += `### 何を大切にして働きたいか？\n${ws2}\n\n`;
    if (ws3) context += `### どんな自分になりたいか？\n${ws3}\n\n`;
  }
  const pp = guideData.prep_point, pr = guideData.prep_reason, pe = guideData.prep_example, pp2 = guideData.prep_point2;
  if (pp || pr || pe || pp2) {
    context += `## PREP法練習シート\n`;
    if (pp) context += `- Point（結論）: ${pp}\n`;
    if (pr) context += `- Reason（理由）: ${pr}\n`;
    if (pe) context += `- Example（具体例）: ${pe}\n`;
    if (pp2) context += `- Point（再結論）: ${pp2}\n`;
    context += "\n";
  }
  if (guideData.ai_generated_axis) context += `## AI自己分析レポート\n${guideData.ai_generated_axis}\n\n`;
  if (guideData.parsed_resume) context += `## 職務経歴書（解析テキスト）\n${guideData.parsed_resume}\n\n`;

  const notes = d.notes.filter((n) => n.createdAt <= T);
  if (notes.length > 0) {
    context += `## CAメモ（${notes.length}件）\n`;
    for (const note of notes) context += `- ${note.author.name} (${note.createdAt.toISOString().slice(0, 10)}): ${note.content}\n`;
    context += "\n";
  }

  const files = d.files.filter((f) => f.createdAt <= T);
  if (files.length > 0) {
    context += `## アップロード済みファイル\n`;
    for (const file of files) context += `- [${label(file.category)}] ${file.fileName}\n`;
    context += "\n";
  }

  const keyFiles = keyFilesAt(d, T, hasLogDigest);
  if (keyFiles.length > 0) {
    context += `## 主要書類の内容\n\n`;
    for (const file of keyFiles) {
      if (!file.driveFileId) continue;
      const raw = file.parsedText ?? "";
      const parsedText =
        file.mimeType === "text/plain" && raw.length > MEETING_TEXT_MAX_CHARS
          ? raw.substring(0, MEETING_TEXT_MAX_CHARS) + "\n...(以下省略)"
          : raw;
      context += `### ${file.fileName}（${label(file.category)}）\n`;
      context += `${parsedText}\n\n`;
    }
  }

  const entries = d.entries.filter((e) => e.createdAt <= T && !excludeEntryIds.has(e.id)).slice(0, 20);
  if (entries.length > 0) {
    context += `## 応募履歴（直近${entries.length}件）\n`;
    for (const entry of entries) {
      const flag = entry.entryFlag || "不明";
      const detail = entry.entryFlagDetail || "";
      context += `- ${entry.companyName || "不明"} / ${entry.jobTitle || "不明"} — ${flag}${detail ? `（${detail}）` : ""}`;
      if (entry.documentSubmitDate) context += ` / 書類提出: ${entry.documentSubmitDate.toISOString().slice(0, 10)}`;
      if (entry.documentPassDate) context += ` / 書類通過: ${entry.documentPassDate.toISOString().slice(0, 10)}`;
      if (entry.firstInterviewDate) context += ` / 一次面接: ${entry.firstInterviewDate.toISOString().slice(0, 10)}`;
      if (entry.finalInterviewDate) context += ` / 最終面接: ${entry.finalInterviewDate.toISOString().slice(0, 10)}`;
      if (entry.offerDate) context += ` / 内定: ${entry.offerDate.toISOString().slice(0, 10)}`;
      if (entry.acceptanceDate) context += ` / 承諾: ${entry.acceptanceDate.toISOString().slice(0, 10)}`;
      if (entry.joinDate) context += ` / 入社: ${entry.joinDate.toISOString().slice(0, 10)}`;
      context += "\n";
    }
    context += "\n";
  }
  // 評価一覧・ブックマーク求人票の節は buildAnalyzeCandidateContext が除去するため作らない
  let text = context.trim();
  if (text.length > MAX_CONTEXT_CHARS) text = text.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
  return { text, entryIds: entries.map((e) => e.id) };
}

function sectionMentions(context: string, company: string): Record<string, number> {
  const out: Record<string, number> = {};
  const key = normCompany(company);
  if (key.length < 2) return out;
  let section = "(先頭)";
  for (const line of context.split("\n")) {
    const h = line.match(/^##\s+([^（(\n]+)/);
    if (h) section = h[1].trim();
    if (normCompany(line).includes(key)) out[section] = (out[section] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------- plan

async function plan(libs: Libs) {
  const { prisma, ab, cache } = libs;
  const now = new Date();
  const funnel: Record<string, number> = {};
  const excluded: Record<string, number> = {};
  const excludedByOutcome: Record<string, Record<string, number>> = { PASS: {}, FAIL: {} };
  const bump = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);

  const bms = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", aiMatchRating: { not: null }, aiAnalyzedAt: { gte: T146_DONE_AT }, extractedText: { not: null } },
    select: {
      id: true, candidateId: true, fileName: true, externalJobRef: true, kyuujinJobId: true,
      aiMatchRating: true, aiAnalysisComment: true, aiAnalyzedAt: true, createdAt: true,
    },
  });
  funnel["評価済みブックマーク（T-146以降・求人本文あり）"] = bms.length;
  const candIds = [...new Set(bms.map((b) => b.candidateId))];
  const entries = await prisma.jobEntry.findMany({
    where: { candidateId: { in: candIds } },
    select: {
      id: true, candidateId: true, companyName: true, externalJobRef: true, externalJobId: true,
      entryFlag: true, entryFlagDetail: true, documentPassDate: true, createdAt: true,
    },
  });
  const bmByCand = new Map<string, typeof bms>();
  for (const b of bms) (bmByCand.get(b.candidateId) ?? bmByCand.set(b.candidateId, []).get(b.candidateId)!).push(b);

  // エントリー → ブックマーク
  type Cand = { bm: (typeof bms)[number]; entry: (typeof entries)[number]; outcome: Outcome; linkBy: PlanFile["linkBy"] };
  const byBm = new Map<string, Cand>();
  let ambiguous = 0;
  for (const e of entries) {
    const o = outcomeOf(e);
    if (!o) continue;
    const list = bmByCand.get(e.candidateId) ?? [];
    let hit = list.filter((b) => e.externalJobRef && b.externalJobRef === e.externalJobRef);
    let linkBy: PlanFile["linkBy"] = "ref";
    if (hit.length === 0) {
      hit = list.filter((b) => b.kyuujinJobId != null && b.kyuujinJobId === e.externalJobId);
      linkBy = "kyuujinJobId";
    }
    if (hit.length === 0) {
      const key = normCompany(e.companyName ?? "");
      hit = key.length >= 2 ? list.filter((b) => normCompany(b.fileName).includes(key)) : [];
      linkBy = "name";
      if (hit.length > 1) { ambiguous++; continue; }
    }
    for (const b of hit) {
      const prev = byBm.get(b.id);
      // 同じブックマークに複数のエントリーが付く場合は、評価より後で最も早いものを使う
      if (!prev || e.createdAt < prev.entry.createdAt) byBm.set(b.id, { bm: b, entry: e, outcome: o, linkBy });
    }
  }
  funnel["書類選考の結果が出たエントリーに紐付くブックマーク"] = byBm.size;
  funnel["（会社名で複数ブックマークに当たり紐付け不能）"] = ambiguous;
  bump(funnel, "  うち通過", [...byBm.values()].filter((c) => c.outcome === "PASS").length);
  bump(funnel, "  うち不合格", [...byBm.values()].filter((c) => c.outcome === "FAIL").length);

  const valid: (Cand & { T: Date; data: CandidateData })[] = [];
  const dataCache = new Map<string, CandidateData>();
  for (const c of byBm.values()) {
    const T = c.bm.aiAnalyzedAt!;
    const reasons: string[] = [];
    if (!headRank(c.bm.aiMatchRating) || !ab.hasValidThreeAxisMarkers(c.bm.aiAnalysisComment)) reasons.push("過去評価の3軸が不揃い");
    if (c.entry.createdAt <= T) reasons.push("評価時点でエントリー済み");
    let data = dataCache.get(c.bm.candidateId);
    if (!data) { data = await loadCandidateData(libs, c.bm.candidateId); dataCache.set(c.bm.candidateId, data); }
    if (reasons.length === 0) reasons.push(...unrestorableReasons(data, T, c.entry.id));
    if (reasons.length > 0) {
      bump(excluded, reasons[0]);
      bump(excludedByOutcome[c.outcome], reasons[0]);
      continue;
    }
    valid.push({ ...c, T, data });
  }
  funnel["時点復元できた"] = valid.length;
  console.log("[plan] funnel", funnel, "除外（先頭理由）", excluded);

  // 抽出: 結果ごとに最大50件・1人8件まで。求職者が偏らないよう、件数の少ない人から順に1件ずつ取る（決定的）
  const picked: typeof valid = [];
  const perCand = new Map<string, number>();
  for (const o of ["PASS", "FAIL"] as Outcome[]) {
    const pool = valid.filter((v) => v.outcome === o).sort((a, b) => a.bm.id.localeCompare(b.bm.id));
    const byC = new Map<string, typeof pool>();
    for (const v of pool) (byC.get(v.bm.candidateId) ?? byC.set(v.bm.candidateId, []).get(v.bm.candidateId)!).push(v);
    let taken = 0;
    let progressed = true;
    while (taken < PER_OUTCOME && progressed) {
      progressed = false;
      const order = [...byC.keys()].sort((a, b) => (perCand.get(a) ?? 0) - (perCand.get(b) ?? 0) || a.localeCompare(b));
      for (const cid of order) {
        if (taken >= PER_OUTCOME) break;
        if ((perCand.get(cid) ?? 0) >= MAX_PER_CANDIDATE) continue;
        const next = byC.get(cid)!.shift();
        if (!next) continue;
        picked.push(next);
        perCand.set(cid, (perCand.get(cid) ?? 0) + 1);
        taken++;
        progressed = true;
      }
    }
  }
  console.log(`[plan] 抽出: 通過 ${picked.filter((p) => p.outcome === "PASS").length} / 不合格 ${picked.filter((p) => p.outcome === "FAIL").length} / 求職者 ${perCand.size}人`);

  // 入力の組み立て（候補者×T時点の候補者情報が同じものを最大5件ずつ）
  const fixedSystem = ab.buildAnalyzeFixedSystem();
  const allTargetEntryIds = new Set(picked.map((p) => p.entry.id));
  const files: PlanFile[] = [];
  const buckets = new Map<string, { cid: string; ctx: string; items: typeof picked }>();
  for (const p of picked) {
    // 同じ求職者のほかの対象エントリーも含めない（T 以前に作られていないことは上で確認済み。念のため）
    const { text, entryIds } = buildContextAt(libs, p.data, p.T, allTargetEntryIds);
    const entriesSection = text.split("## 応募履歴")[1]?.split("\n## ")[0] ?? "";
    files.push({
      id: p.bm.id,
      candidateId: p.bm.candidateId,
      fileName: p.bm.fileName,
      evaluatedAt: p.T.toISOString(),
      entryId: p.entry.id,
      entryCreatedAt: p.entry.createdAt.toISOString(),
      linkBy: p.linkBy,
      outcome: p.outcome,
      entryFlag: p.entry.entryFlag ?? "",
      entryFlagDetail: p.entry.entryFlagDetail,
      past: { rating: p.bm.aiMatchRating!, comment: p.bm.aiAnalysisComment! },
      leak: {
        entryRowIncluded: entryIds.includes(p.entry.id),
        companyInEntries: normCompany(p.entry.companyName ?? "").length >= 2 && normCompany(entriesSection).includes(normCompany(p.entry.companyName ?? "")),
        companyMentions: sectionMentions(text, p.entry.companyName ?? ""),
      },
    });
    const k = `${p.bm.candidateId}\u0000${text}`;
    if (!buckets.has(k)) buckets.set(k, { cid: p.bm.candidateId, ctx: text, items: [] });
    buckets.get(k)!.items.push(p);
  }
  const leaks = files.filter((f) => f.leak.entryRowIncluded || f.leak.companyInEntries);
  if (leaks.length > 0) throw new Error(`答えの混入あり: ${leaks.map((f) => f.id).join(",")}`);

  const groups: PlanGroup[] = [];
  let gi = 0;
  for (const b of buckets.values()) {
    const items = [...b.items].sort((x, y) => y.bm.createdAt.getTime() - x.bm.createdAt.getTime()); // 本番と同じ新しい順
    const texts = await prisma.candidateFile.findMany({
      where: { id: { in: items.map((i) => i.bm.id) } },
      select: { id: true, fileName: true, extractedText: true },
    });
    const tById = new Map(texts.map((t) => [t.id, t]));
    for (let s = 0; s < items.length; s += BATCH_SIZE) {
      const chunk = items.slice(s, s + BATCH_SIZE);
      const batchFiles = chunk.map((i) => tById.get(i.bm.id)!);
      const system = cache.buildAnalyzeBatchSystemBlocks({
        fixedSystem,
        candidateContext: b.ctx,
        batchInstruction: ab.buildBatchInstruction({ totalFiles: chunk.length, start: 0, end: chunk.length, isLastBatch: false }),
      });
      const jobs = ab.buildAnalyzeJobsSection(batchFiles, 0);
      groups.push({
        customId: `g${String(gi++).padStart(3, "0")}`,
        candidateId: b.cid,
        fileIds: chunk.map((i) => i.bm.id),
        system,
        // analyze-batch-run.ts（自動評価経路）と同じ user 文面
        messages: [{ role: "user", content: `## 検討中の求人票（1〜${chunk.length}件目 / 全${chunk.length}件）\n${jobs}\n\n上記の求人について分析してください。` }],
      });
    }
  }

  // 組み方の再現チェック: 評価以降に何も変わっていない求職者を T=今 で組み、本番 lib の出力と比べる
  const repro = { candidates: 0, identical: 0, diffs: [] as string[] };
  const origLog = console.log;
  for (const [cid, d] of dataCache) {
    if (repro.candidates >= 10) break;
    // 未解析の書類がある求職者は本番 lib が Drive 読み取りに行くため比較から外す（対象求人は同じ理由で除外済み）
    if (keyFilesAt(d, now, !!d.candidate.advisorLogDigest?.trim()).some((f) => f.driveFileId && !(f.parsedText ?? "").trim())) continue;
    repro.candidates++;
    const mine = buildContextAt(libs, d, now, new Set()).text;
    console.log = () => {};
    let prod: string;
    try { prod = await ab.buildAnalyzeCandidateContext(cid); } finally { console.log = origLog; }
    // 年齢は Date.now() 由来なので同じ時刻で比べる（数ミリ秒差で年齢が変わることはまず無い）
    if (mine === prod) repro.identical++;
    else {
      let i = 0;
      while (i < mine.length && mine[i] === prod[i]) i++;
      repro.diffs.push(`${cid}: 位置${i} mine=${JSON.stringify(mine.slice(i, i + 60))} prod=${JSON.stringify(prod.slice(i, i + 60))}`);
    }
  }
  console.log(`[plan] 組み方の再現チェック: ${repro.identical}/${repro.candidates} 一致`, repro.diffs);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const p: Plan = { createdAt: now.toISOString(), since: T146_DONE_AT.toISOString(), files, groups, funnel, excluded, excludedByOutcome, reproCheck: repro };
  writeJson(PLAN_PATH, p);
  console.log(`[plan] ${files.length}件・${groups.length}リクエスト → ${PLAN_PATH}`);
}

// ---------------------------------------------------------------- estimate / submit

function paramsFor(effort: Effort, g: PlanGroup) {
  // 本番（Opus 4.6）から temperature を外し、thinking は未指定（Opus 5.5 は常に adaptive）＋ effort。ほかは同じ
  return { model: MODEL_55, max_tokens: 16000, output_config: { effort }, system: g.system, messages: g.messages };
}

function latencyGroups(p: Plan): PlanGroup[] {
  for (let i = 0; i + 1 < p.groups.length; i++) {
    const a = p.groups[i], b = p.groups[i + 1];
    if (a.candidateId === b.candidateId && a.fileIds.length + b.fileIds.length >= 8) return [a, b];
  }
  return [...p.groups].sort((a, b) => b.fileIds.length - a.fileIds.length).slice(0, 2);
}

async function estimate() {
  const p = readJson<Plan>(PLAN_PATH);
  const st = readState();
  const c = client();
  for (const g of p.groups) {
    if (g.inputTokens) continue;
    g.inputTokens = (await c.messages.countTokens({ model: MODEL_55, system: g.system as never, messages: g.messages })).input_tokens;
  }
  writeJson(PLAN_PATH, p);
  const pr = PRICES[MODEL_55];
  // 固定部（SKILL＋評価ルール）のトークン数
  const g0 = p.groups[0];
  const fixedTok = (await c.messages.countTokens({ model: MODEL_55, system: [g0.system[0]] as never, messages: [{ role: "user", content: "。" }] })).input_tokens;
  // 最悪値: 読込の割引は見込まず、固定部は1時間書込・残り（候補者情報＋求人票）は5分書込の単価で数える
  const usd = (g: PlanGroup, effort: Effort, discount: number) =>
    ((fixedTok * pr.write1h + (g.inputTokens! - fixedTok) * pr.write5m + g.fileIds.length * EST_OUTPUT_PER_FILE[effort] * pr.output) / 1e6) * discount;
  const lg = latencyGroups(p);
  const latUsd = lg.reduce((s, g) => s + usd(g, "medium", 1), 0);
  let send = [...p.groups];
  const dropped: string[] = [];
  const fileById = new Map(p.files.map((f) => [f.id, f]));
  const total = () =>
    // 応答時間計測の2リクエストは medium の結果としてそのまま使い、medium のまとめ送りからは外す
    (send.reduce((s, g) => s + usd(g, "low", BATCH_DISCOUNT) + (lg.includes(g) ? 0 : usd(g, "medium", BATCH_DISCOUNT)), 0) + latUsd) * JPY_PER_USD;
  while (total() > BUDGET_JPY * BUDGET_SAFETY && send.length > 0) {
    // 多い方の結果（通過/不合格）を多く含む・1件あたりが高いリクエストから削る
    const ids = new Set(send.flatMap((g) => g.fileIds));
    const cnt = { PASS: 0, FAIL: 0 };
    for (const id of ids) cnt[fileById.get(id)!.outcome]++;
    const major: Outcome = cnt.PASS >= cnt.FAIL ? "PASS" : "FAIL";
    const score = (g: PlanGroup) =>
      g.fileIds.filter((id) => fileById.get(id)!.outcome === major).length / g.fileIds.length +
      usd(g, "medium", 1) / g.fileIds.length;
    const victim = [...send].filter((g) => !lg.includes(g)).sort((a, b) => score(b) - score(a))[0];
    if (!victim) break;
    dropped.push(victim.customId);
    send = send.filter((g) => g !== victim);
  }
  const jpy = {
    low: send.reduce((s, g) => s + usd(g, "low", BATCH_DISCOUNT), 0) * JPY_PER_USD,
    medium: send.filter((g) => !lg.includes(g)).reduce((s, g) => s + usd(g, "medium", BATCH_DISCOUNT), 0) * JPY_PER_USD,
    latency: latUsd * JPY_PER_USD,
  };
  st.estimate = { jpy, jpyTotal: total(), droppedRequests: dropped };
  st.sendGroups = send.map((g) => g.customId);
  writeJson(STATE_PATH, st);
  const n = send.reduce((s, g) => s + g.fileIds.length, 0);
  console.log(`[estimate] 固定部 ${fixedTok} tok / 入力 ${p.groups.reduce((s, g) => s + g.inputTokens!, 0)} tok / 送る ${send.length}リクエスト・${n}件`, jpy, `計 ¥${total().toFixed(0)}（上限¥${BUDGET_JPY}×${BUDGET_SAFETY}）削った=${dropped.join(",") || "なし"}`);
}

async function submit() {
  const p = readJson<Plan>(PLAN_PATH);
  const st = readState();
  if (!st.sendGroups) throw new Error("estimate 未実行");
  const send = new Set(st.sendGroups);
  st.batches ??= {};
  const c = client();
  for (const effort of EFFORTS) {
    if (st.batches[effort]) { console.log(`[submit] ${effort} 投入済み: ${st.batches[effort]}`); continue; }
    const lgIds = new Set(latencyGroups(p).map((g) => g.customId));
    const requests = p.groups.filter((g) => send.has(g.customId) && !(effort === "medium" && lgIds.has(g.customId))).map((g) => ({ custom_id: g.customId, params: paramsFor(effort, g) }));
    const b = await c.messages.batches.create({ requests: requests as never });
    st.batches[effort] = b.id;
    st.submittedAt = new Date().toISOString();
    writeJson(STATE_PATH, st);
    console.log(`[submit] ${effort}=${b.id}（${requests.length}リクエスト）`);
  }
}

function textOf(m: Msg): string {
  return m.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

function usageUsd(u: Usage, discount: number, model = MODEL_55): number {
  const p = PRICES[model];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  return (
    (((u.input_tokens ?? 0) * p.input + w5m * p.write5m + w1h * p.write1h + (u.cache_read_input_tokens ?? 0) * p.read +
      (u.output_tokens ?? 0) * p.output) / 1e6) * discount
  );
}

async function latency() {
  if (fs.existsSync(LATENCY_PATH)) { console.log(`[latency] 計測済み`); return; }
  const p = readJson<Plan>(PLAN_PATH);
  const c = client();
  const out: LatencyRow[] = [];
  for (const g of latencyGroups(p)) {
    const t0 = Date.now();
    const m = (await c.messages.create(paramsFor("medium", g) as never)) as unknown as Msg;
    const ms = Date.now() - t0;
    out.push({ customId: g.customId, ms, usage: m.usage, stop_reason: m.stop_reason, text: textOf(m) });
    console.log(`[latency] medium ${g.customId}（${g.fileIds.length}件） ${(ms / 1000).toFixed(1)}秒 out=${m.usage.output_tokens} read=${m.usage.cache_read_input_tokens} write=${m.usage.cache_creation_input_tokens} stop=${m.stop_reason}`);
    await new Promise((r) => setTimeout(r, 2000)); // 画面と同じ2秒待ち
  }
  writeJson(LATENCY_PATH, out);
}

async function wait() {
  const st = readState();
  if (!st.batches) throw new Error("未投入");
  const c = client();
  for (;;) {
    const status: string[] = [];
    let done = true;
    for (const effort of EFFORTS) {
      const b = await c.messages.batches.retrieve(st.batches[effort]!);
      status.push(`${effort}=${b.processing_status} ${JSON.stringify(b.request_counts)}`);
      if (b.processing_status !== "ended") done = false;
    }
    console.log(`[wait] ${jst(new Date())} ${status.join(" / ")}`);
    if (done) break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  const results: Record<string, Record<string, unknown>> = {};
  for (const effort of EFFORTS) {
    results[effort] = {};
    for await (const r of await c.messages.batches.results(st.batches[effort]!)) results[effort][r.custom_id] = r.result;
  }
  writeJson(RESULTS_PATH, results);
  st.endedAt = new Date().toISOString();
  writeJson(STATE_PATH, st);
  console.log(`[wait] 回収完了 → ${RESULTS_PATH}`);
}

// ---------------------------------------------------------------- report

async function report(libs: Libs) {
  const { ab } = libs;
  const p = readJson<Plan>(PLAN_PATH);
  const st = readState();
  const res = readJson<Record<Effort, Record<string, BatchResult>>>(RESULTS_PATH);
  const lat = fs.existsSync(LATENCY_PATH) ? readJson<LatencyRow[]>(LATENCY_PATH) : [];
  const send = new Set(st.sendGroups ?? []);
  const groups = p.groups.filter((g) => send.has(g.customId));
  const fileById = new Map(p.files.map((f) => [f.id, f]));
  const ids = groups.flatMap((g) => g.fileIds);

  type Out = { rating: Rank | null; pass: string | null; desire: string | null; overall: string | null; broken: boolean; comment: string };
  const ax = (cm: string, k: string) => (cm.replace(/\*\*/g, "").match(new RegExp(`${k}[：:]\\s*(B\\+|[ABCD])`)) || [])[1] ?? null;
  const parseComment = (comment: string, ratingRaw: string | null): Out => {
    const ok = !!headRank(ratingRaw) && !!comment && ab.hasValidThreeAxisMarkers(comment);
    return {
      rating: ok ? headRank(ratingRaw) : null,
      pass: ax(comment, "通過率"), desire: ax(comment, "本人希望"), overall: ax(comment, "■\\s*総合") ?? ax(comment, "総合"),
      broken: !ok, comment,
    };
  };
  const models = ["opus46", "low", "medium"] as const;
  type M = (typeof models)[number];
  const out: Record<M, Map<string, Out>> = { opus46: new Map(), low: new Map(), medium: new Map() };
  const stops: Record<Effort, Record<string, number>> = { low: {}, medium: {} };
  const cost: Record<Effort, number> = { low: 0, medium: 0 };
  const tok: Record<Effort, { in: number; out: number; read: number; write: number; maxOut: number }> = {
    low: { in: 0, out: 0, read: 0, write: 0, maxOut: 0 }, medium: { in: 0, out: 0, read: 0, write: 0, maxOut: 0 },
  };
  const outPerFile: Record<Effort, number[]> = { low: [], medium: [] };
  const costedFiles: Record<Effort, number> = { low: 0, medium: 0 };
  const reqErr: string[] = [];
  for (const id of ids) {
    const f = fileById.get(id)!;
    out.opus46.set(id, parseComment(f.past.comment, f.past.rating));
  }
  const silence = () => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; return () => { console.log = l; console.warn = w; }; };
  for (const effort of EFFORTS) {
    for (const g of groups) {
      // medium の応答時間計測分（通常の送り方）は、その結果をそのまま medium の評価として使う（費用は1件あたりに含めない）
      const latRow = effort === "medium" ? lat.find((l) => l.customId === g.customId) : undefined;
      const r: BatchResult | undefined = latRow
        ? { type: "succeeded", message: { content: [{ type: "text", text: latRow.text }], usage: latRow.usage, stop_reason: latRow.stop_reason } }
        : res[effort]?.[g.customId];
      const batchFiles = g.fileIds.map((id) => ({ id, fileName: fileById.get(id)!.fileName }));
      if (!r || r.type !== "succeeded" || !r.message) {
        reqErr.push(`${effort}:${g.customId}:${r?.type ?? "missing"}`);
        for (const f of batchFiles) out[effort].set(f.id, { rating: null, pass: null, desire: null, overall: null, broken: true, comment: "" });
        continue;
      }
      const m = r.message;
      stops[effort][m.stop_reason] = (stops[effort][m.stop_reason] ?? 0) + 1;
      if (!latRow) { cost[effort] += usageUsd(m.usage, BATCH_DISCOUNT); costedFiles[effort] += g.fileIds.length; }
      tok[effort].in += m.usage.input_tokens ?? 0;
      tok[effort].out += m.usage.output_tokens ?? 0;
      tok[effort].read += m.usage.cache_read_input_tokens ?? 0;
      tok[effort].write += m.usage.cache_creation_input_tokens ?? 0;
      tok[effort].maxOut = Math.max(tok[effort].maxOut, m.usage.output_tokens ?? 0);
      outPerFile[effort].push((m.usage.output_tokens ?? 0) / g.fileIds.length);
      const restore = silence();
      const parsed = ab.extractRatingsAndComments(textOf(m), batchFiles);
      restore();
      for (const f of batchFiles) {
        const e = parsed.get(f.id);
        out[effort].set(f.id, parseComment(e?.comment ?? "", e?.rating ?? null));
      }
    }
  }

  // 通過率の読みの当たり方
  const hiP = (x: string | null) => x === "A" || x === "B";
  const loP = (x: string | null) => x === "C" || x === "D";
  const stat = (k: M, subset: string[] = ids) => {
    const rows = subset.map((id) => ({ o: fileById.get(id)!.outcome, x: out[k].get(id)! }));
    const hi = rows.filter((r) => hiP(r.x.pass));
    const lo = rows.filter((r) => loP(r.x.pass));
    const hiPass = hi.filter((r) => r.o === "PASS").length;
    const loPass = lo.filter((r) => r.o === "PASS").length;
    const rateHi = hi.length ? hiPass / hi.length : NaN;
    const rateLo = lo.length ? loPass / lo.length : NaN;
    const byPass: Record<string, { n: number; pass: number }> = {};
    const byOverall: Record<string, { n: number; pass: number }> = {};
    for (const r of rows) {
      if (r.x.pass) { byPass[r.x.pass] ??= { n: 0, pass: 0 }; byPass[r.x.pass].n++; if (r.o === "PASS") byPass[r.x.pass].pass++; }
      if (r.x.rating) { byOverall[r.x.rating] ??= { n: 0, pass: 0 }; byOverall[r.x.rating].n++; if (r.o === "PASS") byOverall[r.x.rating].pass++; }
    }
    const viol = rows.filter((r) => r.x.pass && r.x.desire && r.x.overall && TABLE[r.x.desire + r.x.pass] !== r.x.overall).length;
    return {
      n: rows.length,
      hiN: hi.length, hiPass, loN: lo.length, loPass,
      rateHi, rateLo, gap: (rateHi - rateLo) * 100,
      miss: rows.filter((r) => r.o === "PASS" && loP(r.x.pass)).length,
      optimistic: rows.filter((r) => r.o === "FAIL" && hiP(r.x.pass)).length,
      passN: rows.filter((r) => r.o === "PASS").length,
      failN: rows.filter((r) => r.o === "FAIL").length,
      broken: rows.filter((r) => r.x.broken).length,
      viol,
      byPass, byOverall,
    };
  };
  const S = Object.fromEntries(models.map((k) => [k, stat(k)])) as Record<M, ReturnType<typeof stat>>;
  // 3者とも読めた件だけの比較（公平性の確認）
  const common = ids.filter((id) => models.every((k) => out[k].get(id)!.pass));
  const SC = Object.fromEntries(models.map((k) => [k, stat(k, common)])) as Record<M, ReturnType<typeof stat>>;
  // T-182（通過率ランク v3.1・2026-08-28 12:41 JST）以降に評価されたものだけ
  const T182 = new Date("2026-08-28T12:41:00+09:00");
  const post182 = ids.filter((id) => new Date(fileById.get(id)!.evaluatedAt) >= T182);
  const SP = Object.fromEntries(models.map((k) => [k, stat(k, post182)])) as Record<M, ReturnType<typeof stat>>;

  // 判定
  const gapLow = S.low.gap, gapMed = S.medium.gap, gap46 = S.opus46.gap;
  const chosen: Effort = gapMed - gapLow > 5 ? "medium" : "low";
  const worse = gap46 - S[chosen].gap >= 10 && S[chosen].miss > S.opus46.miss;

  const nFiles = ids.length;
  const jpyPerFile = (e: Effort) => (cost[e] * JPY_PER_USD) / costedFiles[e];
  const latMs = lat.map((l) => l.ms);
  const latFiles = lat.map((l) => p.groups.find((g) => g.customId === l.customId)!.fileIds.length);
  const latCost = lat.reduce((s, l) => s + usageUsd(l.usage, 1), 0) * JPY_PER_USD;

  // 明細 CSV（個人情報を含む・コミットしない）
  const csv = ["fileId,candidateId,fileName,outcome,entryFlag,entryFlagDetail,evaluatedAt,linkBy,opus46_pass,opus46_overall,low_pass,low_overall,medium_pass,medium_overall"];
  for (const id of ids) {
    const f = fileById.get(id)!;
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    csv.push([f.id, f.candidateId, q(f.fileName), f.outcome, f.entryFlag, f.entryFlagDetail ?? "", jst(new Date(f.evaluatedAt)), f.linkBy,
      ...models.flatMap((k) => [out[k].get(id)!.pass ?? "", out[k].get(id)!.rating ?? ""])].join(","));
  }
  fs.writeFileSync(path.join(OUT_DIR, "detail.csv"), "﻿" + csv.join("\n"), "utf-8");

  const fmtRate = (x: number) => (Number.isNaN(x) ? "-" : `${(x * 100).toFixed(1)}%`);
  const row = (label: string, s: ReturnType<typeof stat>) =>
    `| ${label} | ${s.n} | ${s.hiPass}/${s.hiN}（${fmtRate(s.rateHi)}） | ${s.loPass}/${s.loN}（${fmtRate(s.rateLo)}） | **${Number.isNaN(s.gap) ? "-" : s.gap.toFixed(1)}pt** | ${s.miss} | ${s.optimistic} |`;
  const table = (S2: Record<M, ReturnType<typeof stat>>) => [
    "| モデル・設定 | 件数 | 通過率A/Bの実際の通過 | 通過率C/Dの実際の通過 | 差 | 見逃し（通過なのにC/D） | 楽観（不合格なのにA/B） |",
    "|--|--:|--:|--:|--:|--:|--:|",
    row("Opus 4.6（保存済みの過去評価）", S2.opus46),
    row("Opus 5.5 low", S2.low),
    row("Opus 5.5 medium", S2.medium),
  ].join("\n");
  const axisTable = (key: "byPass" | "byOverall", ranks: readonly string[]) => [
    `| ${key === "byPass" ? "通過率" : "総合"} | ${models.map((k) => (k === "opus46" ? "Opus 4.6" : `5.5 ${k}`)).join(" | ")} |`,
    `|--|${models.map(() => "--:").join("|")}|`,
    ...ranks.map((r) => `| ${r} | ${models.map((k) => { const x = S[k][key][r]; return x ? `${x.pass}/${x.n}（${pct(x.pass, x.n)}）` : "-"; }).join(" | ")} |`),
  ].join("\n");
  const leakMentions: Record<string, number> = {};
  for (const id of ids) for (const [sec, n] of Object.entries(fileById.get(id)!.leak.companyMentions)) leakMentions[sec] = (leakMentions[sec] ?? 0) + n;

  const md = `# T-XXX step4 第1部 集計（ID のみ）

- 作成: ${jst(new Date())} JST / plan 作成: ${jst(new Date(p.createdAt))} JST
- 対象: ${nFiles}件（通過 ${S.opus46.passN}・不合格 ${S.opus46.failN}）・求職者 ${new Set(ids.map((id) => fileById.get(id)!.candidateId)).size}人・${groups.length}リクエスト
- 紐付け: ${["ref", "kyuujinJobId", "name"].map((k) => `${k}=${ids.filter((id) => fileById.get(id)!.linkBy === k).length}`).join(" / ")}

## 抽出の流れ
${Object.entries(p.funnel).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## 対象外（先頭の理由）
${Object.entries(p.excluded).map(([k, v]) => `- ${k}: ${v}（通過 ${p.excludedByOutcome.PASS[k] ?? 0} / 不合格 ${p.excludedByOutcome.FAIL[k] ?? 0}）`).join("\n")}
- 予算で削ったリクエスト: ${(st.estimate?.droppedRequests ?? []).join(",") || "なし"}

## 答えの混入チェック
- 対象エントリー行が候補者情報の応募履歴に入った件数: ${p.files.filter((f) => f.leak.entryRowIncluded).length}
- 応募履歴の節に対象求人の会社名が出た件数: ${p.files.filter((f) => f.leak.companyInEntries).length}
- 候補者情報全体での会社名の出現（節ごと・延べ）: ${JSON.stringify(leakMentions)}
- 組み方の再現チェック（T=今で組んだ結果と本番 lib の出力）: ${p.reproCheck.identical}/${p.reproCheck.candidates} 一致 ${p.reproCheck.diffs.length ? JSON.stringify(p.reproCheck.diffs) : ""}

## 通過率の読みの当たり方（全件）
${table(S)}

## 3者とも通過率を読めた件だけ（${common.length}件）
${table(SC)}

## 参考: T-182（通過率ランク v3.1・8/28 12:41）以降の評価だけ（${post182.length}件）
${table(SP)}

## 通過率ランク別の実際の通過率
${axisTable("byPass", ["A", "B", "C", "D"])}

## 総合ランク別の実際の通過率（参考）
${axisTable("byOverall", RANKS)}

## 表の破り・形式崩れ・途切れ
| | Opus 4.6 | 5.5 low | 5.5 medium |
|--|--:|--:|--:|
| 総合評価表の破り | ${S.opus46.viol} | ${S.low.viol} | ${S.medium.viol} |
| 形式崩れ（3軸・ランクが取り出せない） | ${S.opus46.broken} | ${S.low.broken} | ${S.medium.broken} |
| 途切れ（stop_reason=max_tokens・リクエスト数） | - | ${stops.low.max_tokens ?? 0} | ${stops.medium.max_tokens ?? 0} |
| stop_reason | - | ${JSON.stringify(stops.low)} | ${JSON.stringify(stops.medium)} |
| 1リクエストの最大出力トークン | - | ${tok.low.maxOut} | ${tok.medium.maxOut} |
| 1件あたり出力トークン（平均） | - | ${(tok.low.out / nFiles).toFixed(0)} | ${(tok.medium.out / nFiles).toFixed(0)} |
${reqErr.length ? `- リクエスト失敗: ${reqErr.join(", ")}` : ""}

## 費用・応答時間
| | Opus 4.6 | 5.5 low | 5.5 medium |
|--|--:|--:|--:|
| 1件あたり（Batch 50%込み） | ¥${OPUS46_JPY_PER_FILE_BATCH}（step1 実測） | ¥${jpyPerFile("low").toFixed(2)} | ¥${jpyPerFile("medium").toFixed(2)} |
| 入力 非キャッシュ / 書込 / 読込 | - | ${tok.low.in} / ${tok.low.write} / ${tok.low.read} | ${tok.medium.in} / ${tok.medium.write} / ${tok.medium.read} |
| 出力合計 | - | ${tok.low.out} | ${tok.medium.out} |
| 実費 | - | ¥${(cost.low * JPY_PER_USD).toFixed(0)} | ¥${(cost.medium * JPY_PER_USD).toFixed(0)} |
| 応答時間（通常の送り方・1リクエスト） | 100秒（step3） | 60秒（step3） | ${latMs.map((m, i) => `${(m / 1000).toFixed(1)}秒（${latFiles[i]}件・出力${lat[i].usage.output_tokens}・${lat[i].stop_reason}）`).join(" / ")} 平均 ${latMs.length ? (latMs.reduce((a, b) => a + b, 0) / latMs.length / 1000).toFixed(1) : "-"}秒 |
- 応答時間計測の費用（割引なし）: ¥${latCost.toFixed(0)}
- テストの総費用: ¥${((cost.low + cost.medium) * JPY_PER_USD + latCost).toFixed(0)}（事前見積もり ¥${st.estimate?.jpyTotal.toFixed(0)}）

## 判定
- 差: Opus 4.6 ${gap46.toFixed(1)}pt / low ${gapLow.toFixed(1)}pt / medium ${gapMed.toFixed(1)}pt
- 設定: **${chosen}**（medium − low = ${(gapMed - gapLow).toFixed(1)}pt ${gapMed - gapLow > 5 ? "> 5pt → medium" : "≤ 5pt → low"}）
- 切り替え: **${worse ? "不可（差が10pt以上悪く、見逃しも多い）" : "可"}**（Opus 4.6 − ${chosen} = ${(gap46 - S[chosen].gap).toFixed(1)}pt / 見逃し ${S.opus46.miss} → ${S[chosen].miss}）
`;
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), md, "utf-8");
  console.log(md);
}

// ---------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2];
  if (cmd === "plan") { const libs = await loadLibs(); await plan(libs); await libs.prisma.$disconnect(); return; }
  if (cmd === "estimate") return estimate();
  if (cmd === "submit") return submit();
  if (cmd === "latency") return latency();
  if (cmd === "wait") return wait();
  if (cmd === "report") { const libs = await loadLibs(); await report(libs); await libs.prisma.$disconnect(); return; }
  throw new Error("usage: plan | estimate | submit | latency | wait | report");
}
main().catch((e) => { console.error(e); process.exit(1); });

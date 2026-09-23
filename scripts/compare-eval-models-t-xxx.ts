/**
 * T-XXX: 求人評価（analyze-batch）Opus と Sonnet 5 の比較テスト。
 *
 * 目的: 求人評価の現行モデル（CLAUDE_MODEL_ANALYSIS）を Sonnet 5 に替えても評価の質が保てるかを、
 *       直近30日の過去評価を使って実測する。本番のコード・データは一切変えない検証専用スクリプト。
 *
 * やること:
 *   1. 直近30日・5段階評価（T-146, 2026-07-29〜）以降に評価済みのブックマークから100件を抽出
 *      （総合ランク A/B+/B/C/D 各20件目標・候補者10人程度に集約・1人最大10件）
 *   2. 本番の自動評価経路（src/lib/recommend/analyze-batch-run.ts）と同じ組み方で入力を1回だけ組み立てて固定
 *      （候補者ごと・1リクエスト=求人最大5件・非最終バッチの指示文）
 *   3. 同一入力を A=本番と同じ Opus / B=Sonnet 5 に Message Batches API（半額）で送る
 *   4. 保存済みの過去評価を C として、A-C（Opus 自身のブレ）/ B-A / B-C の一致率等を集計
 *
 * 本番への影響ゼロの担保:
 *   - DB 接続は default_transaction_read_only=on を付けた接続文字列に差し替えてから lib を読み込む
 *     （lib 側の parsedText 永続化などの書き込みが万一走っても DB がエラーで拒否する）。起動時に SHOW で確認。
 *   - 書類読み取り（parsePdfWithAI）を起こさないよう、主要書類が全て解析済み（parsedText あり）の候補者だけを対象にする。
 *   - 評価結果の保存（applyAnalysisResults）・recordAdvisorUsage・advisor_chat_messages は呼ばない。
 *     出力の解析は純関数 extractRatingsAndComments / hasValidThreeAxisMarkers のみ使う。
 *   - 本番 lib の関数は import で呼ぶだけ（変更なし）。
 *
 * 出力（個人情報を含むためコミットしない・scripts/output/ は .gitignore 済み）:
 *   scripts/output/t-xxx-eval-compare/plan.json      … 固定した入力一式
 *   scripts/output/t-xxx-eval-compare/state.json     … 見積もり・batch ID
 *   scripts/output/t-xxx-eval-compare/results.json   … 生の応答
 *   scripts/output/t-xxx-eval-compare/detail.csv     … 全件明細
 *   scripts/output/t-xxx-eval-compare/compare.html   … 読み比べ用（15件）
 *   scripts/output/t-xxx-eval-compare/summary.md     … 集計（ID のみ。報告書の材料）
 *
 * 実行（master worktree・.env は本番DB proxy 直結）:
 *   ANTHROPIC_API_KEY=... npx tsx --env-file=.env scripts/compare-eval-models-t-xxx.ts all
 *   サブコマンド: plan（抽出・入力固定・トークン計数・見積もり）/ submit / wait / report / all
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join("scripts", "output", "t-xxx-eval-compare");
const PLAN_PATH = path.join(OUT_DIR, "plan.json");
const STATE_PATH = path.join(OUT_DIR, "state.json");
const RESULTS_PATH = path.join(OUT_DIR, "results.json");

// T-146 の5段階化（P2-1〜P2-7）が master に揃った日時。これ以前の評価は4段階のため対象外。
const T146_DONE_AT = new Date("2026-07-29T00:23:20+09:00");
const WINDOW_DAYS = 30;

const TARGET_TOTAL = 100;
const PER_RANK_QUOTA = 20;
const MAX_PER_CANDIDATE = 10;
const MAX_CANDIDATES = 15;
const BATCH_SIZE = 5; // 本番（CA画面 batchSize / 自動評価 BATCH_SIZE）と同一

const MODEL_B = "claude-sonnet-5";

// 公式料金表（https://platform.claude.com/docs/en/about-claude/pricing・2026-09-24 取得）$/MTok。
// Batch API は入出力・キャッシュとも 50% 割引（キャッシュ倍率と重ねがけ）。
type Price = { input: number; output: number; write5m: number; write1h: number; read: number };
const PRICES: Record<string, Price> = {
  "claude-opus-4-6": { input: 5, output: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, write5m: 2.5, write1h: 4, read: 0.2 },
};
const BATCH_DISCOUNT = 0.5;
// 為替: open.er-api.com（2026-09-23 00:02 UTC 更新）USD/JPY = 157.415417
const JPY_PER_USD = 157.42;
const BUDGET_JPY = 1000;
// 見積もりで上限に対して残す余裕（見積もり誤差・形式崩れ時の再送なし前提の安全幅）
const BUDGET_SAFETY = 0.9;

const RANKS = ["A", "B+", "B", "C", "D"] as const;
type Rank = (typeof RANKS)[number];
const RANK_SCORE: Record<Rank, number> = { A: 4, "B+": 3, B: 2, C: 1, D: 0 };

type PlanFile = {
  id: string;
  candidateId: string;
  fileName: string;
  pastRating: Rank; // C
  pastRatingRaw: string;
  pastComment: string;
  pastAnalyzedAt: string;
  // 評価後に候補者の書類・面談記録が更新された（C 比較から除く）
  changedAfterEval: boolean;
  changedReasons: string[];
  // 参考: 応募履歴（JobEntry）の更新もあった（厳しめ定義の再集計用）
  jobEntryChangedAfterEval: boolean;
};

type PlanGroup = {
  customId: string;
  candidateId: string;
  fileIds: string[];
  start: number;
  end: number;
  totalFiles: number;
  system: unknown[];
  messages: { role: "user"; content: string }[];
  countA?: number;
  countB?: number;
};

type Plan = {
  createdAt: string;
  modelA: string;
  modelB: string;
  since: string;
  files: PlanFile[];
  groups: PlanGroup[];
  poolStats: Record<string, unknown>;
};

type State = {
  estimate?: {
    avgOutputPerFileA: number;
    tokenizerRatio: number;
    usdA: number;
    usdB: number;
    jpyTotal: number;
    droppedRequests: string[];
  };
  batchA?: string;
  batchB?: string;
  submittedAt?: string;
  endedAt?: string;
};

function jst(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function writeJson(p: string, v: unknown) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf-8");
}

function headRank(raw: string | null | undefined): Rank | null {
  const m = (raw ?? "").trim().match(/^(B\+|[ABCD])/);
  return m ? (m[1] as Rank) : null;
}

// DB を読み取り専用にしてから lib を読み込む（lib の prisma シングルトンは import 時に接続設定を読む）。
async function loadLibs() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未設定（npx tsx --env-file=.env で実行）");
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();

  const { prisma } = await import("@/lib/prisma");
  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>(
    "SHOW default_transaction_read_only",
  );
  if (ro[0]?.default_transaction_read_only !== "on") {
    throw new Error("読み取り専用接続になっていないため中止");
  }
  const claude = await import("@/lib/claude");
  const ab = await import("@/lib/analyze-bookmarks");
  const cache = await import("@/lib/analyze-batch-cache");
  return { prisma, claude, ab, cache };
}

type Libs = Awaited<ReturnType<typeof loadLibs>>;

function anthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 未設定");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function paramsFor(model: string, g: PlanGroup, modelA: string) {
  if (model === modelA) {
    // A: 本番（analyze-batch route / recommend analyze-batch-run）と同じパラメータ
    return {
      model,
      max_tokens: 16000,
      temperature: 0.7,
      system: g.system,
      messages: g.messages,
    };
  }
  // B: Sonnet 5 は temperature を受け付けない（400）ため外す。
  //    本番 Opus 4.6 は thinking 未指定＝思考なしなので、Sonnet 5（未指定だと adaptive）は明示的に無効化して揃える。
  return {
    model,
    max_tokens: 16000,
    thinking: { type: "disabled" },
    system: g.system,
    messages: g.messages,
  };
}

// ---------------------------------------------------------------- plan

async function plan(libs: Libs) {
  const { prisma, claude, ab, cache } = libs;
  const modelA = claude.CLAUDE_MODEL_ANALYSIS;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400_000);
  const since = windowStart > T146_DONE_AT ? windowStart : T146_DONE_AT;
  console.log(`[plan] 本番評価モデル=${modelA} / 対象期間: ${jst(since)} 〜 ${jst(now)} (JST)`);

  // 1. 過去評価の母集団
  const rows = await prisma.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      archivedAt: null,
      extractedText: { not: null },
      aiMatchRating: { not: null },
      aiAnalyzedAt: { gte: since },
    },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      aiMatchRating: true,
      aiAnalysisComment: true,
      aiAnalyzedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const valid = rows.filter(
    (r) => headRank(r.aiMatchRating) && ab.hasValidThreeAxisMarkers(r.aiAnalysisComment),
  );
  console.log(`[plan] 母集団: 評価済み ${rows.length}件 / 3軸揃い ${valid.length}件`);

  // 2. 候補者の適格性（主要書類が全て解析済み＝書類読み取り費用・DB書き込みが発生しない）
  const candIds = [...new Set(valid.map((r) => r.candidateId))];
  const cands = await prisma.candidate.findMany({
    where: { id: { in: candIds } },
    select: { id: true, advisorLogDigest: true, advisorLogDigestUpdatedAt: true },
  });
  const candById = new Map(cands.map((c) => [c.id, c]));
  const eligible = new Set<string>();
  let ineligibleOcr = 0;
  for (const c of cands) {
    const hasLogDigest = !!c.advisorLogDigest?.trim();
    // src/lib/advisor-context.ts getCandidateContext の keyFiles クエリと同条件
    const keyFiles = await prisma.candidateFile.findMany({
      where: {
        candidateId: c.id,
        category: { in: ["ORIGINAL", "BS_DOCUMENT", "MEETING"] },
        mimeType: { in: ["application/pdf", "text/plain"] },
        ...(hasLogDigest ? { NOT: { category: "MEETING", mimeType: "text/plain" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { driveFileId: true, parsedText: true },
    });
    const ok = keyFiles.every((f) => !f.driveFileId || (f.parsedText ?? "").trim() !== "");
    if (ok) eligible.add(c.id);
    else ineligibleOcr++;
  }
  console.log(`[plan] 候補者 ${cands.length}人中 適格 ${eligible.size}人（未解析書類ありで除外 ${ineligibleOcr}人）`);

  // 3. 抽出（ランク均等・候補者集約）
  const pool = new Map<string, Map<Rank, typeof valid>>();
  for (const r of valid) {
    if (!eligible.has(r.candidateId)) continue;
    const rank = headRank(r.aiMatchRating)!;
    if (!pool.has(r.candidateId)) pool.set(r.candidateId, new Map());
    const m = pool.get(r.candidateId)!;
    if (!m.has(rank)) m.set(rank, []);
    m.get(rank)!.push(r);
  }
  const poolRankTotals = Object.fromEntries(
    RANKS.map((rk) => [rk, [...pool.values()].reduce((s, m) => s + (m.get(rk)?.length ?? 0), 0)]),
  );
  console.log(`[plan] 適格プールのランク別件数`, poolRankTotals);

  const need: Record<Rank, number> = { A: PER_RANK_QUOTA, "B+": PER_RANK_QUOTA, B: PER_RANK_QUOTA, C: PER_RANK_QUOTA, D: PER_RANK_QUOTA };
  const picked = new Map<string, typeof valid>(); // candidateId -> files
  const pickedIds = new Set<string>();
  const total = () => pickedIds.size;

  const takeFrom = (cid: string, fillAny: boolean) => {
    const m = pool.get(cid)!;
    const list = picked.get(cid) ?? [];
    let progressed = true;
    while (list.length < MAX_PER_CANDIDATE && total() < TARGET_TOTAL && progressed) {
      progressed = false;
      const order = [...RANKS].sort((a, b) => need[b] - need[a]);
      for (const rk of order) {
        if (list.length >= MAX_PER_CANDIDATE || total() >= TARGET_TOTAL) break;
        if (!fillAny && need[rk] <= 0) continue;
        const next = (m.get(rk) ?? []).find((f) => !pickedIds.has(f.id));
        if (!next) continue;
        list.push(next);
        pickedIds.add(next.id);
        need[rk]--;
        progressed = true;
      }
    }
    if (list.length > 0) picked.set(cid, list);
  };

  const gain = (cid: string) => {
    const m = pool.get(cid)!;
    return Math.min(
      MAX_PER_CANDIDATE,
      RANKS.reduce((s, rk) => s + Math.min(Math.max(need[rk], 0), m.get(rk)?.length ?? 0), 0),
    );
  };
  // 段1: 足りない段を多く埋められる候補者から貪欲に選ぶ
  while (total() < TARGET_TOTAL && picked.size < MAX_CANDIDATES) {
    const rest = [...pool.keys()].filter((c) => !picked.has(c));
    if (rest.length === 0) break;
    rest.sort((a, b) => gain(b) - gain(a));
    if (gain(rest[0]) === 0) break;
    takeFrom(rest[0], false);
  }
  // 段2: 足りない段はほかの段で埋める（選んだ候補者→新しい候補者の順）
  for (const cid of [...picked.keys()]) if (total() < TARGET_TOTAL) takeFrom(cid, true);
  while (total() < TARGET_TOTAL && picked.size < MAX_CANDIDATES) {
    const rest = [...pool.keys()].filter((c) => !picked.has(c));
    if (rest.length === 0) break;
    const sizeOf = (c: string) => [...pool.get(c)!.values()].reduce((s, l) => s + l.length, 0);
    rest.sort((a, b) => sizeOf(b) - sizeOf(a));
    takeFrom(rest[0], true);
  }
  console.log(`[plan] 抽出: ${total()}件 / 候補者 ${picked.size}人`);

  // 4. C 比較の除外判定（評価後に書類・面談記録が更新されたか）
  const files: PlanFile[] = [];
  for (const [cid, list] of picked) {
    const c = candById.get(cid)!;
    const [docs, notes, guide, entries] = await Promise.all([
      prisma.candidateFile.findMany({
        where: { candidateId: cid, category: { not: "BOOKMARK" } },
        select: { createdAt: true, category: true },
      }),
      prisma.candidateNote.findMany({ where: { candidateId: cid }, select: { createdAt: true, updatedAt: true } }),
      prisma.guideEntry.findFirst({ where: { candidateId: cid, guideType: "INTERVIEW" }, select: { updatedAt: true } }),
      prisma.jobEntry.findMany({ where: { candidateId: cid }, select: { createdAt: true, updatedAt: true } }),
    ]);
    for (const f of list) {
      const t = f.aiAnalyzedAt!;
      const reasons: string[] = [];
      if (c.advisorLogDigestUpdatedAt && c.advisorLogDigestUpdatedAt > t) reasons.push("面談ログ要約");
      if (docs.some((d) => d.createdAt > t)) reasons.push("書類追加");
      if (notes.some((n) => n.createdAt > t || n.updatedAt > t)) reasons.push("CAメモ");
      if (guide && guide.updatedAt > t) reasons.push("面談ガイド");
      files.push({
        id: f.id,
        candidateId: cid,
        fileName: f.fileName,
        pastRating: headRank(f.aiMatchRating)!,
        pastRatingRaw: f.aiMatchRating!,
        pastComment: f.aiAnalysisComment!,
        pastAnalyzedAt: t.toISOString(),
        changedAfterEval: reasons.length > 0,
        changedReasons: reasons,
        jobEntryChangedAfterEval: entries.some((e) => e.createdAt > t || e.updatedAt > t),
      });
    }
  }

  // 5. 入力を1回だけ組み立てて固定（本番の自動評価経路と同じ組み方）
  const fixedSystem = ab.buildAnalyzeFixedSystem();
  const groups: PlanGroup[] = [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  let gi = 0;
  for (const [cid, list] of picked) {
    const context = await ab.buildAnalyzeCandidateContext(cid);
    if (!context.trim()) console.warn(`[plan] 候補者context が空: ${cid}`);
    const texts = await prisma.candidateFile.findMany({
      where: { id: { in: list.map((f) => f.id) } },
      select: { id: true, fileName: true, extractedText: true, createdAt: true },
      orderBy: { createdAt: "desc" }, // analyze-batch の並び順（createdAt desc）
    });
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, texts.length);
      const batchFiles = texts.slice(start, end);
      const jobsSection = ab.buildAnalyzeJobsSection(batchFiles, start);
      const system = cache.buildAnalyzeBatchSystemBlocks({
        fixedSystem,
        candidateContext: context,
        batchInstruction: ab.buildBatchInstruction({ totalFiles: texts.length, start, end, isLastBatch: false }),
      });
      groups.push({
        customId: `g${String(gi++).padStart(3, "0")}`,
        candidateId: cid,
        fileIds: batchFiles.map((f) => f.id),
        start,
        end,
        totalFiles: texts.length,
        system,
        messages: [
          {
            role: "user",
            content: `## 検討中の求人票（${start + 1}〜${end}件目 / 全${texts.length}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
          },
        ],
      });
      for (const f of batchFiles) if (!fileById.has(f.id)) throw new Error(`plan 不整合: ${f.id}`);
    }
  }

  const p: Plan = {
    createdAt: now.toISOString(),
    modelA,
    modelB: MODEL_B,
    since: since.toISOString(),
    files,
    groups,
    poolStats: {
      evaluated: rows.length,
      validThreeAxis: valid.length,
      candidates: cands.length,
      eligibleCandidates: eligible.size,
      ineligibleOcr,
      poolRankTotals,
    },
  };

  // 6. トークン計数（無料）と費用見積もり → 上限を超えるなら候補者単位で削る
  const client = anthropicClient();
  for (const g of groups) {
    const a = await client.messages.countTokens({
      model: modelA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      system: g.system as any,
      messages: g.messages,
    });
    const b = await client.messages.countTokens({
      model: MODEL_B,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      system: g.system as any,
      messages: g.messages,
      thinking: { type: "disabled" },
    });
    g.countA = a.input_tokens;
    g.countB = b.input_tokens;
  }
  const sumA = groups.reduce((s, g) => s + g.countA!, 0);
  const sumB = groups.reduce((s, g) => s + g.countB!, 0);
  const tokenizerRatio = sumB / sumA;

  // 出力トークンの見積もり: 直近30日の analyze-batch 実績（1件あたり出力）
  const logs = await prisma.advisorUsageLog.findMany({
    where: {
      createdAt: { gte: since },
      endpoint: { in: ["analyze-batch", "recommend-analyze"] },
      fileCount: { gt: 0 },
      outputTokens: { gt: 0 },
    },
    select: {
      endpoint: true,
      outputTokens: true,
      fileCount: true,
      note: true,
      inputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });
  const nonLast = logs.filter((l) => l.note !== "last-batch");
  const avgOutputPerFileA =
    nonLast.reduce((s, l) => s + l.outputTokens, 0) / Math.max(1, nonLast.reduce((s, l) => s + (l.fileCount ?? 0), 0));

  // 入力の課金内訳は、本番で同じ Message Batches API を使っている自動評価（recommend-analyze）の実績比率を使う。
  // Batch ではキャッシュ参照がベストエフォートのため、理想的なキャッシュ前提では過小見積もりになる。
  const rec = logs.filter((l) => l.endpoint === "recommend-analyze");
  const recIn = rec.reduce((s, l) => s + l.inputTokens, 0);
  const recRead = rec.reduce((s, l) => s + l.cacheReadTokens, 0);
  const recWrite = rec.reduce((s, l) => s + l.cacheCreationTokens, 0);
  const recAll = recIn + recRead + recWrite;
  const mix =
    recAll > 0
      ? { uncached: recIn / recAll, read: recRead / recAll, write: recWrite / recAll }
      : { uncached: 0, read: 0, write: 1 };
  console.log(
    `[plan] 見積もり用の入力内訳（recommend-analyze 実績）: 非キャッシュ ${(mix.uncached * 100).toFixed(1)}% / 読取 ${(mix.read * 100).toFixed(1)}% / 書込 ${(mix.write * 100).toFixed(1)}%`,
  );

  // 見積もり: 入力は上記の実績内訳で課金（書込は全て 1h＝2x 単価で数える安全側）、出力は実績平均の1.2倍。
  const inputRate = (pr: Price) => mix.uncached * pr.input + mix.read * pr.read + mix.write * pr.write1h;
  const estimate = (groupsIn: PlanGroup[]) => {
    let usdA = 0;
    let usdB = 0;
    for (const g of groupsIn) {
      const outA = avgOutputPerFileA * g.fileIds.length * 1.2;
      usdA += ((g.countA! * inputRate(PRICES[modelA]) + outA * PRICES[modelA].output) / 1e6) * BATCH_DISCOUNT;
      usdB += ((g.countB! * inputRate(PRICES[MODEL_B]) + outA * tokenizerRatio * PRICES[MODEL_B].output) / 1e6) * BATCH_DISCOUNT;
    }
    return { usdA, usdB, jpy: (usdA + usdB) * JPY_PER_USD };
  };
  let est = estimate(groups);
  const dropped: string[] = [];
  // 上限超過時は、多すぎる段（過去評価ランク）を多く含むリクエストから1本ずつ外す（候補者丸ごとは外さない）。
  while (est.jpy > BUDGET_JPY * BUDGET_SAFETY && p.groups.length > 0) {
    const counts: Record<string, number> = {};
    for (const f of p.files) counts[f.pastRating] = (counts[f.pastRating] ?? 0) + 1;
    const pastOf = new Map(p.files.map((f) => [f.id, f.pastRating]));
    const score = (g: PlanGroup) => g.fileIds.reduce((s, id) => s + (counts[pastOf.get(id)!] ?? 0), 0) / g.fileIds.length;
    const victim = [...p.groups].sort((a, b) => score(b) - score(a))[0];
    dropped.push(victim.customId);
    p.groups = p.groups.filter((g) => g !== victim);
    const gone = new Set(victim.fileIds);
    p.files = p.files.filter((f) => !gone.has(f.id));
    est = estimate(p.groups);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJson(PLAN_PATH, p);
  const state: State = {
    estimate: {
      avgOutputPerFileA,
      tokenizerRatio,
      usdA: est.usdA,
      usdB: est.usdB,
      jpyTotal: est.jpy,
      droppedRequests: dropped,
    },
  };
  writeJson(STATE_PATH, state);
  const rankCount = Object.fromEntries(RANKS.map((rk) => [rk, p.files.filter((f) => f.pastRating === rk).length]));
  console.log(
    `[plan] 確定: ${p.files.length}件 / 候補者 ${new Set(p.files.map((f) => f.candidateId)).size}人 / リクエスト ${p.groups.length}本`,
    rankCount,
  );
  console.log(
    `[plan] 入力トークン Opus=${sumA} Sonnet5=${sumB}（Sonnet5/Opus=${tokenizerRatio.toFixed(3)}）/ 1件あたり出力実績=${avgOutputPerFileA.toFixed(0)}`,
  );
  console.log(
    `[plan] 見積もり: A=$${est.usdA.toFixed(3)} B=$${est.usdB.toFixed(3)} 計 ¥${est.jpy.toFixed(0)}（上限¥${BUDGET_JPY}・安全幅${BUDGET_SAFETY}）削ったリクエスト=${dropped.length}`,
  );
}

// ---------------------------------------------------------------- submit / wait

async function submit() {
  const p = readJson<Plan>(PLAN_PATH);
  const state = readJson<State>(STATE_PATH);
  if (state.batchA || state.batchB) {
    console.log(`[submit] 投入済み: A=${state.batchA} B=${state.batchB}（二重投入しない）`);
    return;
  }
  const client = anthropicClient();
  const mk = (model: string) =>
    p.groups.map((g) => ({ custom_id: g.customId, params: paramsFor(model, g, p.modelA) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = await client.messages.batches.create({ requests: mk(p.modelA) as any });
  state.batchA = a.id;
  writeJson(STATE_PATH, state);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = await client.messages.batches.create({ requests: mk(p.modelB) as any });
  state.batchB = b.id;
  state.submittedAt = new Date().toISOString();
  writeJson(STATE_PATH, state);
  console.log(`[submit] A=${a.id} B=${b.id}（${p.groups.length}リクエストずつ）`);
}

async function wait() {
  const state = readJson<State>(STATE_PATH);
  if (!state.batchA || !state.batchB) throw new Error("未投入");
  const client = anthropicClient();
  for (;;) {
    const [a, b] = await Promise.all([
      client.messages.batches.retrieve(state.batchA),
      client.messages.batches.retrieve(state.batchB),
    ]);
    console.log(
      `[wait] ${jst(new Date())} A=${a.processing_status} ${JSON.stringify(a.request_counts)} / B=${b.processing_status} ${JSON.stringify(b.request_counts)}`,
    );
    if (a.processing_status === "ended" && b.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  const results: Record<string, Record<string, unknown>> = { A: {}, B: {} };
  for (const [key, id] of [["A", state.batchA], ["B", state.batchB]] as const) {
    for await (const r of await client.messages.batches.results(id)) {
      results[key][r.custom_id] = r.result;
    }
  }
  writeJson(RESULTS_PATH, results);
  state.endedAt = new Date().toISOString();
  writeJson(STATE_PATH, state);
  console.log(`[wait] 回収完了 → ${RESULTS_PATH}`);
}

// ---------------------------------------------------------------- report

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

function usageUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  return (
    (((u.input_tokens ?? 0) * p.input +
      w5m * p.write5m +
      w1h * p.write1h +
      (u.cache_read_input_tokens ?? 0) * p.read +
      (u.output_tokens ?? 0) * p.output) /
      1e6) *
    BATCH_DISCOUNT
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`;
}

async function report(libs: Libs) {
  const { prisma, ab } = libs;
  const p = readJson<Plan>(PLAN_PATH);
  const state = readJson<State>(STATE_PATH);
  const results = readJson<Record<"A" | "B", Record<string, { type: string; message?: { content: { type: string; text?: string }[]; usage: Usage; stop_reason: string } }>>>(RESULTS_PATH);
  const fileById = new Map(p.files.map((f) => [f.id, f]));

  type Out = { rating: Rank | null; comment: string; broken: boolean; reason: string };
  const out: Record<"A" | "B", Map<string, Out>> = { A: new Map(), B: new Map() };
  const cost = { A: 0, B: 0 };
  const tok: Record<"A" | "B", Required<Pick<Usage, "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">>> = {
    A: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    B: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const requestErrors: string[] = [];
  const stopReasons: Record<"A" | "B", Record<string, number>> = { A: {}, B: {} };

  for (const key of ["A", "B"] as const) {
    const model = key === "A" ? p.modelA : p.modelB;
    for (const g of p.groups) {
      const r = results[key][g.customId];
      const batchFiles = g.fileIds.map((id) => ({ id, fileName: fileById.get(id)!.fileName }));
      if (!r || r.type !== "succeeded" || !r.message) {
        requestErrors.push(`${key}:${g.customId}:${r?.type ?? "missing"}`);
        for (const f of batchFiles) out[key].set(f.id, { rating: null, comment: "", broken: true, reason: `request-${r?.type ?? "missing"}` });
        continue;
      }
      const m = r.message;
      stopReasons[key][m.stop_reason] = (stopReasons[key][m.stop_reason] ?? 0) + 1;
      cost[key] += usageUsd(model, m.usage);
      for (const k of Object.keys(tok[key]) as (keyof (typeof tok)["A"])[]) tok[key][k] += m.usage[k] ?? 0;
      // 本番と同じく content[0].text を読む
      const first = m.content[0];
      const text = first && first.type === "text" ? first.text ?? "" : "";
      const parsed = ab.extractRatingsAndComments(text, batchFiles);
      for (const f of batchFiles) {
        const e = parsed.get(f.id);
        const rating = headRank(e?.rating);
        const comment = e?.comment ?? "";
        const ok = !!rating && !!comment && ab.hasValidThreeAxisMarkers(comment);
        out[key].set(f.id, {
          rating: ok ? rating : null,
          comment,
          broken: !ok,
          reason: ok ? "" : !e ? "section-not-found" : !rating ? "no-rating" : "3axis-missing",
        });
      }
    }
  }

  // ---- 集計
  type Pair = { x: Rank; y: Rank };
  const agree = (pairs: Pair[]) => {
    const n = pairs.length;
    const exact = pairs.filter((q) => q.x === q.y).length;
    const within1 = pairs.filter((q) => Math.abs(RANK_SCORE[q.x] - RANK_SCORE[q.y]) <= 1).length;
    return { n, exact, within1 };
  };
  const ids = p.files.map((f) => f.id);
  const r = (k: "A" | "B", id: string) => out[k].get(id)?.rating ?? null;
  const pairsAC: Pair[] = [];
  const pairsBC: Pair[] = [];
  const pairsBA: Pair[] = [];
  const pairsACstrict: Pair[] = [];
  const pairsBCstrict: Pair[] = [];
  for (const id of ids) {
    const f = fileById.get(id)!;
    const a = r("A", id);
    const b = r("B", id);
    if (a && b) pairsBA.push({ x: b, y: a });
    if (!f.changedAfterEval) {
      if (a) pairsAC.push({ x: a, y: f.pastRating });
      if (b) pairsBC.push({ x: b, y: f.pastRating });
      if (!f.jobEntryChangedAfterEval) {
        if (a) pairsACstrict.push({ x: a, y: f.pastRating });
        if (b) pairsBCstrict.push({ x: b, y: f.pastRating });
      }
    }
  }
  const sAC = agree(pairsAC);
  const sBA = agree(pairsBA);
  const sBC = agree(pairsBC);
  const sACs = agree(pairsACstrict);
  const sBCs = agree(pairsBCstrict);
  const high = (x: Rank) => x === "A" || x === "B+";
  const low = (x: Rank) => x === "C" || x === "D";
  const miss = pairsBA.filter((q) => high(q.y) && low(q.x)).length;
  const aHigh = pairsBA.filter((q) => high(q.y)).length;
  const push = pairsBA.filter((q) => low(q.y) && high(q.x)).length;
  const aLow = pairsBA.filter((q) => low(q.y)).length;
  // 参考: Opus 自身のブレにおける同じ指標（A を基準に C がどう動いたか）
  const missAC = pairsAC.filter((q) => high(q.y) && low(q.x)).length;
  const pushAC = pairsAC.filter((q) => low(q.y) && high(q.x)).length;
  const upDown = (pairs: Pair[]) => ({
    up: pairs.filter((q) => RANK_SCORE[q.x] > RANK_SCORE[q.y]).length,
    down: pairs.filter((q) => RANK_SCORE[q.x] < RANK_SCORE[q.y]).length,
  });

  const confusion = (pairs: Pair[]) => {
    // 行 = y（基準）, 列 = x
    const m: Record<Rank, Record<Rank, number>> = Object.fromEntries(
      RANKS.map((a) => [a, Object.fromEntries(RANKS.map((b) => [b, 0]))]),
    ) as Record<Rank, Record<Rank, number>>;
    for (const q of pairs) m[q.y][q.x]++;
    return m;
  };
  const confTable = (pairs: Pair[], rowLabel: string, colLabel: string) => {
    const m = confusion(pairs);
    const lines = [
      `| ${rowLabel} ＼ ${colLabel} | ${RANKS.join(" | ")} | 計 |`,
      `|--|${RANKS.map(() => "--:").join("|")}|--:|`,
    ];
    for (const y of RANKS) {
      const row = RANKS.map((x) => (x === y ? `**${m[y][x]}**` : String(m[y][x])));
      lines.push(`| ${y} | ${row.join(" | ")} | ${RANKS.reduce((s, x) => s + m[y][x], 0)} |`);
    }
    return lines.join("\n");
  };

  const brokenA = ids.filter((id) => out.A.get(id)?.broken).length;
  const brokenB = ids.filter((id) => out.B.get(id)?.broken).length;
  const brokenReasons = (k: "A" | "B") => {
    const c: Record<string, number> = {};
    for (const id of ids) {
      const o = out[k].get(id);
      if (o?.broken) c[o.reason] = (c[o.reason] ?? 0) + 1;
    }
    return c;
  };
  const nFiles = ids.length;
  const perFileJpy = { A: (cost.A / nFiles) * JPY_PER_USD, B: (cost.B / nFiles) * JPY_PER_USD };
  const totalJpy = (cost.A + cost.B) * JPY_PER_USD;
  const ratio = cost.B / cost.A;
  const outRatio = tok.B.output_tokens / tok.A.output_tokens;
  const inAll = (k: "A" | "B") => tok[k].input_tokens + tok[k].cache_read_input_tokens + tok[k].cache_creation_input_tokens;

  // 直近30日の実績（AdvisorUsageLog）
  const since30 = new Date(Date.now() - WINDOW_DAYS * 86400_000);
  const logs = await prisma.advisorUsageLog.groupBy({
    by: ["endpoint", "model"],
    where: { createdAt: { gte: since30 } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  logs.sort((a, b) => (b._sum.costUsd ?? 0) - (a._sum.costUsd ?? 0));
  const allUsd = logs.reduce((s, l) => s + (l._sum.costUsd ?? 0), 0);
  const evalUsd = logs
    .filter((l) => (l.endpoint === "analyze-batch" || l.endpoint === "recommend-analyze") && l.model === p.modelA)
    .reduce((s, l) => s + (l._sum.costUsd ?? 0), 0);

  const excludedC = p.files.filter((f) => f.changedAfterEval).length;
  const reasonCount: Record<string, number> = {};
  for (const f of p.files) for (const rr of f.changedReasons) reasonCount[rr] = (reasonCount[rr] ?? 0) + 1;
  const rankCount = Object.fromEntries(RANKS.map((rk) => [rk, p.files.filter((f) => f.pastRating === rk).length]));

  const baseExact = sAC.n ? sAC.exact / sAC.n : 0;
  const baExact = sBA.n ? sBA.exact / sBA.n : 0;
  const missRate = sBA.n ? miss / sBA.n : 0;
  const passAgree = baExact >= baseExact - 0.05;
  const passMiss = missRate <= 0.03;

  const md: string[] = [];
  md.push(`## 集計（scripts/compare-eval-models-t-xxx.ts report・${jst(new Date())} JST）`);
  md.push("");
  md.push(`- 実施件数: ${nFiles}件 / 候補者 ${new Set(p.files.map((f) => f.candidateId)).size}人 / リクエスト ${p.groups.length}本（1本=求人最大5件）`);
  md.push(`- 過去評価（C）のランク内訳: ${RANKS.map((rk) => `${rk}=${rankCount[rk]}`).join(" / ")}`);
  md.push(`- C 比較から除いた件数: ${excludedC}件（${Object.entries(reasonCount).map(([k, v]) => `${k} ${v}`).join("・") || "なし"}。重複あり）`);
  md.push(`- 形式崩れ: A(Opus)=${brokenA}件 ${JSON.stringify(brokenReasons("A"))} / B(Sonnet)=${brokenB}件 ${JSON.stringify(brokenReasons("B"))}`);
  md.push(`- リクエスト失敗: ${requestErrors.length ? requestErrors.join(", ") : "なし"} / stop_reason A=${JSON.stringify(stopReasons.A)} B=${JSON.stringify(stopReasons.B)}`);
  md.push("");
  md.push(`| 比較 | 件数 | 完全一致率 | 1段差以内率 | 上振れ/下振れ（左が右より） |`);
  md.push(`|--|--:|--:|--:|--|`);
  const row = (name: string, s: { n: number; exact: number; within1: number }, pairs: Pair[]) => {
    const ud = upDown(pairs);
    md.push(`| ${name} | ${s.n} | ${pct(s.exact, s.n)} | ${pct(s.within1, s.n)} | 上 ${ud.up} / 下 ${ud.down} |`);
  };
  row("A（Opus 再実行）vs C（過去の Opus）＝Opus のブレ", sAC, pairsAC);
  row("B（Sonnet 5）vs A（Opus 再実行）", sBA, pairsBA);
  row("B（Sonnet 5）vs C（過去の Opus）", sBC, pairsBC);
  row("（参考・厳しめ）A vs C 応募履歴更新も除外", sACs, pairsACstrict);
  row("（参考・厳しめ）B vs C 応募履歴更新も除外", sBCs, pairsBCstrict);
  md.push("");
  md.push(`- 取りこぼし（A が A/B+ なのに B が C/D）: ${miss}件（比較${sBA.n}件中 ${pct(miss, sBA.n)}・A が A/B+ の${aHigh}件中 ${pct(miss, aHigh)}）`);
  md.push(`- 押し上げ（A が C/D なのに B が A/B+）: ${push}件（比較${sBA.n}件中 ${pct(push, sBA.n)}・A が C/D の${aLow}件中 ${pct(push, aLow)}）`);
  md.push(`- 参考: Opus 自身のブレで同じ動き（A→C）: 取りこぼし型 ${missAC}件 / 押し上げ型 ${pushAC}件（比較${sAC.n}件中）`);
  md.push("");
  md.push(`### 混同表 A（Opus 再実行・行）× B（Sonnet 5・列）`);
  md.push("");
  md.push(confTable(pairsBA, "A", "B"));
  md.push("");
  md.push(`### 参考: 混同表 C（過去の Opus・行）× A（Opus 再実行・列）`);
  md.push("");
  md.push(confTable(pairsAC, "C", "A"));
  md.push("");
  md.push(`### 費用`);
  md.push("");
  md.push(`| | Opus（A） | Sonnet 5（B） |`);
  md.push(`|--|--:|--:|`);
  md.push(`| 入力合計（非キャッシュ+書込+読取） | ${inAll("A").toLocaleString()} | ${inAll("B").toLocaleString()} |`);
  md.push(`| うち非キャッシュ | ${tok.A.input_tokens.toLocaleString()} | ${tok.B.input_tokens.toLocaleString()} |`);
  md.push(`| うちキャッシュ書込 | ${tok.A.cache_creation_input_tokens.toLocaleString()} | ${tok.B.cache_creation_input_tokens.toLocaleString()} |`);
  md.push(`| うちキャッシュ読取 | ${tok.A.cache_read_input_tokens.toLocaleString()} | ${tok.B.cache_read_input_tokens.toLocaleString()} |`);
  md.push(`| 出力 | ${tok.A.output_tokens.toLocaleString()} | ${tok.B.output_tokens.toLocaleString()} |`);
  md.push(`| 実費（Batch 50%込み） | $${cost.A.toFixed(3)}（¥${(cost.A * JPY_PER_USD).toFixed(0)}） | $${cost.B.toFixed(3)}（¥${(cost.B * JPY_PER_USD).toFixed(0)}） |`);
  md.push(`| 1件あたり | ¥${perFileJpy.A.toFixed(2)} | ¥${perFileJpy.B.toFixed(2)} |`);
  md.push("");
  md.push(`- 同じ入力を Sonnet 5 が数えたトークン数: Opus 4.6 の ${(state.estimate!.tokenizerRatio * 100).toFixed(1)}%（count_tokens・${p.groups.length}リクエスト合計）`);
  md.push(`- 出力トークン: Sonnet 5 は Opus の ${(outRatio * 100).toFixed(1)}%`);
  md.push(`- 費用比 B/A = ${(ratio * 100).toFixed(1)}%`);
  md.push(`- テスト総費用: ¥${totalJpy.toFixed(0)}（書類読み取り ¥0＝解析済み候補者のみ対象）/ 事前見積もり¥${state.estimate!.jpyTotal.toFixed(0)} / 差 ¥${(totalJpy - state.estimate!.jpyTotal).toFixed(0)}`);
  md.push("");
  md.push(`### 直近30日の AI 費用実績（AdvisorUsageLog・${jst(since30).slice(0, 10)}〜）`);
  md.push("");
  md.push(`| 機能(endpoint) | モデル | コール数 | 費用 |`);
  md.push(`|--|--|--:|--:|`);
  for (const l of logs) {
    md.push(`| ${l.endpoint} | ${l.model} | ${l._count._all} | ¥${((l._sum.costUsd ?? 0) * JPY_PER_USD).toFixed(0)} |`);
  }
  md.push(`| 計 | | | ¥${(allUsd * JPY_PER_USD).toFixed(0)} |`);
  md.push("");
  md.push(`- 求人評価（analyze-batch + recommend-analyze・${p.modelA}）: ¥${(evalUsd * JPY_PER_USD).toFixed(0)}/30日`);
  md.push(`- Sonnet 5 切り替え後の試算: ¥${(evalUsd * ratio * JPY_PER_USD).toFixed(0)}/30日（実績 × 費用比 ${(ratio * 100).toFixed(1)}%）＝ 月 ¥${(evalUsd * (1 - ratio) * JPY_PER_USD).toFixed(0)} 減`);
  md.push("");
  md.push(`### 判定の目安`);
  md.push("");
  md.push(`- B vs A 完全一致率 ${pct(sBA.exact, sBA.n)} / Opus のブレ基準（A vs C）${pct(sAC.exact, sAC.n)} → 差 ${((baExact - baseExact) * 100).toFixed(1)}pt（5pt以内: ${passAgree ? "該当" : "非該当"}）`);
  md.push(`- 取りこぼし率 ${pct(miss, sBA.n)}（3%以下: ${passMiss ? "該当" : "非該当"}）`);
  md.push(`- → 切り替え候補: **${passAgree && passMiss ? "該当" : "非該当"}**`);
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), md.join("\n"), "utf-8");

  // ---- 明細 CSV（個人情報を含み得るためコミットしない）
  const csvEsc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    [
      "file_id", "candidate_id", "file_name", "custom_id", "C_past", "C_past_raw", "A_opus", "B_sonnet",
      "A_broken", "B_broken", "c_excluded", "c_excluded_reasons", "job_entry_changed", "past_analyzed_at_jst",
    ].join(","),
  ];
  const groupOf = new Map<string, string>();
  for (const g of p.groups) for (const id of g.fileIds) groupOf.set(id, g.customId);
  for (const f of p.files) {
    csv.push(
      [
        f.id, f.candidateId, f.fileName, groupOf.get(f.id), f.pastRating, f.pastRatingRaw,
        out.A.get(f.id)?.rating ?? "", out.B.get(f.id)?.rating ?? "",
        out.A.get(f.id)?.broken ? out.A.get(f.id)!.reason : "", out.B.get(f.id)?.broken ? out.B.get(f.id)!.reason : "",
        f.changedAfterEval ? 1 : 0, f.changedReasons.join("/"), f.jobEntryChangedAfterEval ? 1 : 0, jst(new Date(f.pastAnalyzedAt)),
      ].map(csvEsc).join(","),
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, "detail.csv"), "﻿" + csv.join("\n"), "utf-8");

  // ---- 読み比べ HTML（ずれ10件＋一致5件）
  const both = p.files.filter((f) => out.A.get(f.id)?.rating && out.B.get(f.id)?.rating);
  const diffOf = (f: PlanFile) => Math.abs(RANK_SCORE[out.A.get(f.id)!.rating!] - RANK_SCORE[out.B.get(f.id)!.rating!]);
  const mismatches = both.filter((f) => diffOf(f) > 0).sort((a, b) => diffOf(b) - diffOf(a)).slice(0, 10);
  const matches = both.filter((f) => diffOf(f) === 0);
  // 一致はランクが偏らないように段ごとに1件ずつ
  const matchPick: PlanFile[] = [];
  for (const rk of RANKS) {
    const m = matches.find((f) => out.A.get(f.id)!.rating === rk && !matchPick.includes(f));
    if (m) matchPick.push(m);
  }
  for (const m of matches) if (matchPick.length < 5 && !matchPick.includes(m)) matchPick.push(m);
  const brokenBFiles = p.files.filter((f) => out.B.get(f.id)?.broken).slice(0, 3);
  const cards = [...mismatches, ...matchPick.slice(0, 5), ...brokenBFiles]
    .map((f) => {
      const a = out.A.get(f.id)!;
      const b = out.B.get(f.id)!;
      return `<section class="card">
  <h2>${esc(f.fileName)}</h2>
  <p class="meta">file=${f.id} / candidate=${f.candidateId} / 過去(C)=${f.pastRatingRaw} / Opus(A)=${a.rating ?? "形式崩れ"} / Sonnet(B)=${b.rating ?? `形式崩れ(${b.reason})`}${f.changedAfterEval ? " / C比較除外" : ""}</p>
  <div class="cols">
    <div><h3>Opus（A）</h3><pre>${esc(a.comment)}</pre></div>
    <div><h3>Sonnet 5（B）</h3><pre>${esc(b.comment)}</pre></div>
  </div>
</section>`;
    })
    .join("\n");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opus vs Sonnet 読み比べ</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--card:#fafafa}
@media (prefers-color-scheme: dark){:root{--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--card:#1f1f1f}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}
.card{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:12px;margin:0 0 16px}
h2{font-size:15px;margin:0 0 4px}.meta{color:var(--muted);font-size:12px;margin:0 0 8px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.cols{grid-template-columns:1fr}}
pre{white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.55;margin:0}h3{font-size:13px;margin:0 0 4px}
</style></head><body>
<h1 style="font-size:18px">求人評価 Opus vs Sonnet 5 読み比べ（ずれ${mismatches.length}件＋一致${Math.min(5, matchPick.length)}件${brokenBFiles.length ? `＋Sonnet形式崩れ${brokenBFiles.length}件` : ""}）</h1>
${cards}
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, "compare.html"), html, "utf-8");

  console.log(md.join("\n"));
  console.log(`\n[report] ${OUT_DIR} に summary.md / detail.csv / compare.html を出力`);
}

// ---------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2] ?? "all";
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (cmd === "submit") return submit();
  if (cmd === "wait") return wait();
  const libs = await loadLibs();
  try {
    if (cmd === "plan") await plan(libs);
    else if (cmd === "report") await report(libs);
    else if (cmd === "all") {
      await plan(libs);
      await submit();
      await wait();
      await report(libs);
    } else throw new Error(`unknown command: ${cmd}`);
  } finally {
    await libs.prisma.$disconnect();
    await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export {};

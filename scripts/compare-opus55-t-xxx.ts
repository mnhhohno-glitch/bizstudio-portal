/**
 * T-XXX step3 第2部: 求人評価（analyze-batch）Opus 4.6 と Opus 5.5 の比較テスト。
 *
 * 目的: 手動評価（CA がブックマークして押す評価）を Opus 5.5 に替えたときの質・費用・応答時間を実測する。
 *       本番のコード・データは一切変えない検証専用スクリプト。
 *
 * やること:
 *   1. 入力は step1（scripts/compare-eval-models-t-xxx.ts）が固定した plan.json をそのまま使う（100件・11人・21リクエスト）。
 *      A（Opus 4.6 再実行）・C（過去の Opus 評価）は step1 の results.json / plan.json を使い、Opus 4.6 は再実行しない。
 *   2. D = Opus 5.5 に Message Batches API（半額）で送る。
 *      Opus 5.5 は temperature と thinking の無効化を受け付けないため、本番から次の置き換えをする:
 *        - temperature: 0.7 → 外す
 *        - thinking 未指定（Opus 4.6 では思考なし）→ 未指定のまま（Opus 5.5 は常に adaptive thinking）＋ effort を最も軽い "low"
 *      本番が読む content[0].text は、Opus 5.5 では先頭が thinking ブロックになるため、text ブロックを連結して読む。
 *   3. 応答時間: 同じ候補者の2リクエスト（約10件）を通常の送り方（非ストリーミング・本番と同じ）で
 *      Opus 4.6（本番パラメータ）と Opus 5.5 の両方に送り、1回あたりの所要時間を測る。
 *   4. D-A / D-C の一致率・取りこぼし・押し上げ・総合評価表の破り・形式崩れ・費用・混同表を集計。
 *
 * 本番への影響ゼロの担保:
 *   - DB は default_transaction_read_only=on を付けた接続（起動時に SHOW で確認）。DB はランク取り出しの lib 読み込みのためだけに繋ぐ。
 *   - 評価結果の保存（applyAnalysisResults）・recordAdvisorUsage・advisor_chat_messages は呼ばない。
 *     出力の解析は純関数 extractRatingsAndComments / hasValidThreeAxisMarkers のみ。
 *
 * 出力（個人情報を含むためコミットしない・scripts/output/ は .gitignore 済み）: scripts/output/t-xxx-opus55/
 *
 * 実行（master worktree）:
 *   ANTHROPIC_API_KEY=... npx tsx --env-file=.env scripts/compare-opus55-t-xxx.ts all
 *   サブコマンド: plan / submit / latency / wait / report / all
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const STEP1_DIR = path.join("scripts", "output", "t-xxx-eval-compare");
const OUT_DIR = path.join("scripts", "output", "t-xxx-opus55");
const STATE_PATH = path.join(OUT_DIR, "state.json");
const RESULTS_PATH = path.join(OUT_DIR, "results-d.json");
const LATENCY_PATH = path.join(OUT_DIR, "latency.json");

const MODEL_A = "claude-opus-4-6";
const MODEL_D = "claude-opus-5-5";
const EFFORT_D = "low";

// 公式料金表（https://platform.claude.com/docs/en/about-claude/pricing・2026-09-24 取得）$/MTok
type Price = { input: number; output: number; write5m: number; write1h: number; read: number };
const PRICES: Record<string, Price> = {
  [MODEL_A]: { input: 5, output: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  [MODEL_D]: { input: 4, output: 20, write5m: 5, write1h: 8, read: 0.2 }, // 読込は 0.05x
};
const BATCH_DISCOUNT = 0.5;
const JPY_PER_USD = 157.42; // step1 と同じ
const BUDGET_JPY = 1000;
const BUDGET_SAFETY = 0.9;
// 考える工程ぶんの出力増を見込む安全係数（見積もり用）
const THINKING_ALLOWANCE = 1.6;

const RANKS = ["A", "B+", "B", "C", "D"] as const;
type Rank = (typeof RANKS)[number];
const RANK_SCORE: Record<Rank, number> = { A: 4, "B+": 3, B: 2, C: 1, D: 0 };
// 総合評価テーブル（本人希望 × 通過率 → 総合）。step1 の axis-check と同じ
const TABLE: Record<string, Rank> = {
  AA: "A", AB: "B+", BA: "B+", AC: "B", AD: "B", BB: "B", BC: "C", BD: "C",
  CA: "C", CB: "C", CC: "C", CD: "D", DA: "D", DB: "D", DC: "D", DD: "D",
};

type PlanFile = {
  id: string; candidateId: string; fileName: string; pastRating: Rank; pastRatingRaw: string;
  changedAfterEval: boolean; changedReasons: string[]; jobEntryChangedAfterEval: boolean;
};
type PlanGroup = {
  customId: string; candidateId: string; fileIds: string[]; system: unknown[];
  messages: { role: "user"; content: string }[]; countA?: number;
};
type Plan = { modelA: string; files: PlanFile[]; groups: PlanGroup[] };
type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};
type Msg = { content: { type: string; text?: string }[]; usage: Usage; stop_reason: string };
type BatchResult = { type: string; message?: Msg };
type State = {
  inputCheck?: { step1PlanCreatedAt: string; groups: number; files: number; changed: number };
  paramProbe?: Record<string, string>;
  counts?: Record<string, { a: number; d: number }>;
  estimate?: { usdD: number; usdLatency: number; jpyTotal: number; droppedRequests: string[]; tokenizerRatio: number };
  sendGroups?: string[];
  batchD?: string;
  submittedAt?: string;
  endedAt?: string;
};

function jst(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
}
const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, "utf-8")) as T;
const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf-8");
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function headRank(raw: string | null | undefined): Rank | null {
  const m = (raw ?? "").trim().match(/^(B\+|[ABCD])/);
  return m ? (m[1] as Rank) : null;
}
function readState(): State {
  return fs.existsSync(STATE_PATH) ? readJson<State>(STATE_PATH) : {};
}
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 未設定");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 600_000 });
}
function loadPlan(): Plan {
  return readJson<Plan>(path.join(STEP1_DIR, "plan.json"));
}

// A: 本番（analyze-batch route）と同じパラメータ / D: Opus 5.5 で使える範囲で本番に最も近い設定
function paramsFor(model: string, g: PlanGroup) {
  if (model === MODEL_A) {
    return { model, max_tokens: 16000, temperature: 0.7, system: g.system, messages: g.messages };
  }
  return { model, max_tokens: 16000, output_config: { effort: EFFORT_D }, system: g.system, messages: g.messages };
}

// 本番は content[0].text を読む。Opus 5.5 は先頭が thinking ブロックになるため text ブロックを連結して読む。
function textOf(m: Msg): string {
  return m.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

function usageUsd(model: string, u: Usage, discount: number): number {
  const p = PRICES[model];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  return (
    (((u.input_tokens ?? 0) * p.input + w5m * p.write5m + w1h * p.write1h + (u.cache_read_input_tokens ?? 0) * p.read +
      (u.output_tokens ?? 0) * p.output) / 1e6) * discount
  );
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
  const ab = await import("@/lib/analyze-bookmarks");
  return { prisma, ab };
}

// ---------------------------------------------------------------- plan

// 応答時間の計測に使うリクエスト: 同じ候補者で5件ずつの2本（最初に見つかったもの）
function latencyGroups(p: Plan): PlanGroup[] {
  for (let i = 0; i + 1 < p.groups.length; i++) {
    const a = p.groups[i], b = p.groups[i + 1];
    if (a.candidateId === b.candidateId && a.fileIds.length === 5 && b.fileIds.length === 5) return [a, b];
  }
  return p.groups.slice(0, 2);
}

async function plan() {
  const p = loadPlan();
  const st = readState();
  const c = client();

  // 入力の確認: step1 の plan.json をそのまま使う（組み直しなし）＝入力が変わった件数は0
  st.inputCheck = { step1PlanCreatedAt: (p as unknown as { createdAt: string }).createdAt, groups: p.groups.length, files: p.files.length, changed: 0 };

  // Opus 5.5 のパラメータ可否を実測（400 は課金されない）
  const probe: Record<string, string> = {};
  const tiny = { model: MODEL_D, max_tokens: 16, messages: [{ role: "user" as const, content: "1+1=?" }] };
  const tryCall = async (name: string, extra: Record<string, unknown>) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await c.messages.create({ ...tiny, ...extra } as any);
      probe[name] = "accepted";
    } catch (e) {
      probe[name] = e instanceof Anthropic.APIError ? `${e.status}: ${(e.message ?? "").slice(0, 160)}` : String(e);
    }
  };
  await tryCall("temperature=0.7", { temperature: 0.7 });
  await tryCall("thinking=disabled", { thinking: { type: "disabled" } });
  st.paramProbe = probe;
  console.log("[plan] Opus 5.5 パラメータ確認", probe);

  // トークン計数（無料）
  const counts: Record<string, { a: number; d: number }> = {};
  for (const g of p.groups) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await c.messages.countTokens({ model: MODEL_A, system: g.system as any, messages: g.messages });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await c.messages.countTokens({ model: MODEL_D, system: g.system as any, messages: g.messages });
    counts[g.customId] = { a: a.input_tokens, d: d.input_tokens };
  }
  st.counts = counts;
  const sumA = Object.values(counts).reduce((s, x) => s + x.a, 0);
  const sumD = Object.values(counts).reduce((s, x) => s + x.d, 0);
  const ratio = sumD / sumA;

  // 見積もり: 入力の課金内訳は step1 A（同じ21リクエストの Batch 実績）の比率、出力は A の実出力 × 語数比 × 考える工程の安全係数
  const resA = readJson<Record<"A", Record<string, BatchResult>>>(path.join(STEP1_DIR, "results.json")).A;
  let aIn = 0, aRead = 0, aWrite = 0;
  for (const g of p.groups) {
    const u = resA[g.customId]?.message?.usage ?? {};
    aIn += u.input_tokens ?? 0; aRead += u.cache_read_input_tokens ?? 0; aWrite += u.cache_creation_input_tokens ?? 0;
  }
  const all = aIn + aRead + aWrite;
  const mix = { uncached: aIn / all, read: aRead / all, write: aWrite / all };
  const pd = PRICES[MODEL_D];
  const inRate = mix.uncached * pd.input + mix.read * pd.read + mix.write * pd.write1h; // 書込は全て1h単価で数える安全側
  const estGroup = (g: PlanGroup, discount: number) => {
    const outA = resA[g.customId]?.message?.usage.output_tokens ?? 5000;
    return ((counts[g.customId].d * inRate + outA * ratio * THINKING_ALLOWANCE * pd.output) / 1e6) * discount;
  };
  // 応答時間の計測（通常の送り方・割引なし）: 4.6 と 5.5 を2本ずつ。キャッシュ無しの満額で見積もる安全側
  const lg = latencyGroups(p);
  const pa = PRICES[MODEL_A];
  const usdLatency = lg.reduce((s, g) => {
    const outA = resA[g.customId]?.message?.usage.output_tokens ?? 5000;
    return s + (counts[g.customId].a * pa.write1h + outA * pa.output) / 1e6 + (counts[g.customId].d * pd.write1h + outA * ratio * THINKING_ALLOWANCE * pd.output) / 1e6;
  }, 0);

  let send = [...p.groups];
  const dropped: string[] = [];
  const total = () => (send.reduce((s, g) => s + estGroup(g, BATCH_DISCOUNT), 0) + usdLatency) * JPY_PER_USD;
  while (total() > BUDGET_JPY * BUDGET_SAFETY && send.length > 0) {
    // 多すぎる段（過去評価ランク）を多く含むリクエストから外す
    const cnt: Record<string, number> = {};
    const ids = new Set(send.flatMap((g) => g.fileIds));
    for (const f of p.files) if (ids.has(f.id)) cnt[f.pastRating] = (cnt[f.pastRating] ?? 0) + 1;
    const pastOf = new Map(p.files.map((f) => [f.id, f.pastRating]));
    const score = (g: PlanGroup) => g.fileIds.reduce((s, id) => s + (cnt[pastOf.get(id)!] ?? 0), 0) / g.fileIds.length;
    const victim = [...send].sort((a, b) => score(b) - score(a))[0];
    dropped.push(victim.customId);
    send = send.filter((g) => g !== victim);
  }
  const usdD = send.reduce((s, g) => s + estGroup(g, BATCH_DISCOUNT), 0);
  st.estimate = { usdD, usdLatency, jpyTotal: total(), droppedRequests: dropped, tokenizerRatio: ratio };
  st.sendGroups = send.map((g) => g.customId);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJson(STATE_PATH, st);
  console.log(`[plan] 入力トークン Opus4.6=${sumA} Opus5.5=${sumD}（5.5/4.6=${ratio.toFixed(3)}）`);
  console.log(`[plan] 見積もり: D(Batch)=$${usdD.toFixed(3)} 応答時間計測=$${usdLatency.toFixed(3)} 計 ¥${total().toFixed(0)}（上限¥${BUDGET_JPY}・安全幅${BUDGET_SAFETY}）削ったリクエスト=${dropped.join(",") || "なし"}`);
}

// ---------------------------------------------------------------- submit / wait / latency

async function submit() {
  const p = loadPlan();
  const st = readState();
  if (st.batchD) {
    console.log(`[submit] 投入済み: ${st.batchD}（二重投入しない）`);
    return;
  }
  if (!st.sendGroups) throw new Error("plan 未実行");
  const send = new Set(st.sendGroups);
  const requests = p.groups.filter((g) => send.has(g.customId)).map((g) => ({ custom_id: g.customId, params: paramsFor(MODEL_D, g) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = await client().messages.batches.create({ requests: requests as any });
  st.batchD = b.id;
  st.submittedAt = new Date().toISOString();
  writeJson(STATE_PATH, st);
  console.log(`[submit] D=${b.id}（${requests.length}リクエスト）`);
}

async function latency() {
  if (fs.existsSync(LATENCY_PATH)) {
    console.log(`[latency] 計測済み（${LATENCY_PATH}）`);
    return;
  }
  const p = loadPlan();
  const c = client();
  const lg = latencyGroups(p);
  const out: { model: string; customId: string; ms: number; usage: Usage; stop_reason: string; text: string }[] = [];
  // 本番の CA 画面と同じく、同じ候補者の2本を順番に送る（モデルごとに1回目=キャッシュ書込、2回目=読込が本番の形）
  for (const model of [MODEL_A, MODEL_D]) {
    for (const g of lg) {
      const t0 = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (await c.messages.create(paramsFor(model, g) as any)) as unknown as Msg;
      const ms = Date.now() - t0;
      out.push({ model, customId: g.customId, ms, usage: m.usage, stop_reason: m.stop_reason, text: textOf(m) });
      console.log(`[latency] ${model} ${g.customId} ${(ms / 1000).toFixed(1)}秒 out=${m.usage.output_tokens} read=${m.usage.cache_read_input_tokens} write=${m.usage.cache_creation_input_tokens}`);
      await new Promise((r) => setTimeout(r, 2000)); // 画面と同じ2秒待ち
    }
  }
  writeJson(LATENCY_PATH, out);
}

async function wait() {
  const st = readState();
  if (!st.batchD) throw new Error("未投入");
  const c = client();
  for (;;) {
    const b = await c.messages.batches.retrieve(st.batchD);
    console.log(`[wait] ${jst(new Date())} D=${b.processing_status} ${JSON.stringify(b.request_counts)}`);
    if (b.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  const results: Record<string, unknown> = {};
  for await (const r of await c.messages.batches.results(st.batchD)) results[r.custom_id] = r.result;
  writeJson(RESULTS_PATH, results);
  st.endedAt = new Date().toISOString();
  writeJson(STATE_PATH, st);
  console.log(`[wait] 回収完了 → ${RESULTS_PATH}`);
}

// ---------------------------------------------------------------- report

async function report(libs: Awaited<ReturnType<typeof loadLibs>>) {
  const { ab } = libs;
  const p = loadPlan();
  const st = readState();
  const resA = readJson<Record<"A", Record<string, BatchResult>>>(path.join(STEP1_DIR, "results.json")).A;
  const resD = readJson<Record<string, BatchResult>>(RESULTS_PATH);
  const lat = fs.existsSync(LATENCY_PATH) ? readJson<{ model: string; customId: string; ms: number; usage: Usage; stop_reason: string; text: string }[]>(LATENCY_PATH) : [];
  const fileById = new Map(p.files.map((f) => [f.id, f]));
  const sent = p.groups.filter((g) => (st.sendGroups ?? []).includes(g.customId));
  const ids = sent.flatMap((g) => g.fileIds);
  const c = client();

  type Out = { rating: Rank | null; comment: string; broken: boolean; reason: string; axes?: { d: string; p: string; o: string } };
  const out: Record<"A" | "D", Map<string, Out>> = { A: new Map(), D: new Map() };
  const cost = { A: 0, D: 0 };
  const tok = { A: { in: 0, out: 0, read: 0, write: 0, text: 0 }, D: { in: 0, out: 0, read: 0, write: 0, text: 0 } };
  const stops: Record<"A" | "D", Record<string, number>> = { A: {}, D: {} };
  const reqErr: string[] = [];
  const ax = (cm: string, k: string) => (cm.replace(/\*\*/g, "").match(new RegExp(`${k}[：:]\\s*(B\\+|[ABCD])`)) || [])[1];
  const silence = () => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; return () => { console.log = l; console.warn = w; }; };

  for (const key of ["A", "D"] as const) {
    const model = key === "A" ? MODEL_A : MODEL_D;
    for (const g of sent) {
      const r = key === "A" ? resA[g.customId] : resD[g.customId];
      const batchFiles = g.fileIds.map((id) => ({ id, fileName: fileById.get(id)!.fileName }));
      if (!r || r.type !== "succeeded" || !r.message) {
        reqErr.push(`${key}:${g.customId}:${r?.type ?? "missing"}`);
        for (const f of batchFiles) out[key].set(f.id, { rating: null, comment: "", broken: true, reason: `request-${r?.type ?? "missing"}` });
        continue;
      }
      const m = r.message;
      stops[key][m.stop_reason] = (stops[key][m.stop_reason] ?? 0) + 1;
      cost[key] += usageUsd(model, m.usage, BATCH_DISCOUNT);
      tok[key].in += m.usage.input_tokens ?? 0;
      tok[key].out += m.usage.output_tokens ?? 0;
      tok[key].read += m.usage.cache_read_input_tokens ?? 0;
      tok[key].write += m.usage.cache_creation_input_tokens ?? 0;
      const text = textOf(m);
      // 見える本文のトークン数（無料の count_tokens。出力 − 本文 ＝ 考える工程の分の推定）
      const base = (await c.messages.countTokens({ model, messages: [{ role: "user", content: "。" }] })).input_tokens;
      const withText = (await c.messages.countTokens({ model, messages: [{ role: "user", content: "。" + text }] })).input_tokens;
      tok[key].text += withText - base;
      const restore = silence();
      const parsed = ab.extractRatingsAndComments(text, batchFiles);
      restore();
      for (const f of batchFiles) {
        const e = parsed.get(f.id);
        const rating = headRank(e?.rating);
        const comment = e?.comment ?? "";
        const ok = !!rating && !!comment && ab.hasValidThreeAxisMarkers(comment);
        const d = ax(comment, "本人希望"), pp = ax(comment, "通過率"), o = ax(comment, "■\\s*総合") ?? ax(comment, "総合");
        out[key].set(f.id, {
          rating: ok ? rating : null, comment, broken: !ok,
          reason: ok ? "" : !e ? "section-not-found" : !rating ? "no-rating" : "3axis-missing",
          axes: d && pp && o ? { d, p: pp, o } : undefined,
        });
      }
    }
  }

  type Pair = { x: Rank; y: Rank };
  const agree = (ps: Pair[]) => ({ n: ps.length, exact: ps.filter((q) => q.x === q.y).length, within1: ps.filter((q) => Math.abs(RANK_SCORE[q.x] - RANK_SCORE[q.y]) <= 1).length });
  const upDown = (ps: Pair[]) => ({ up: ps.filter((q) => RANK_SCORE[q.x] > RANK_SCORE[q.y]).length, down: ps.filter((q) => RANK_SCORE[q.x] < RANK_SCORE[q.y]).length });
  const rOf = (k: "A" | "D", id: string) => out[k].get(id)?.rating ?? null;
  const pDA: Pair[] = [], pDC: Pair[] = [], pAC: Pair[] = [], pDCs: Pair[] = [], pACs: Pair[] = [];
  for (const id of ids) {
    const f = fileById.get(id)!;
    const a = rOf("A", id), d = rOf("D", id);
    if (a && d) pDA.push({ x: d, y: a });
    if (!f.changedAfterEval) {
      if (d) pDC.push({ x: d, y: f.pastRating });
      if (a) pAC.push({ x: a, y: f.pastRating });
      if (!f.jobEntryChangedAfterEval) {
        if (d) pDCs.push({ x: d, y: f.pastRating });
        if (a) pACs.push({ x: a, y: f.pastRating });
      }
    }
  }
  const sDA = agree(pDA), sDC = agree(pDC), sAC = agree(pAC);
  const high = (x: Rank) => x === "A" || x === "B+";
  const low = (x: Rank) => x === "C" || x === "D";
  const miss = pDA.filter((q) => high(q.y) && low(q.x)).length;
  const push = pDA.filter((q) => low(q.y) && high(q.x)).length;
  const aHigh = pDA.filter((q) => high(q.y)).length;
  const aLow = pDA.filter((q) => low(q.y)).length;
  const missDC = pDC.filter((q) => high(q.y) && low(q.x)).length;

  // 総合評価テーブルの破り
  const viol = (k: "A" | "D") => {
    let n = 0, v = 0;
    const list: string[] = [];
    for (const id of ids) {
      const a = out[k].get(id)?.axes;
      if (!a) continue;
      n++;
      if (TABLE[a.d + a.p] !== a.o) { v++; list.push(`${id}: 本人希望${a.d}×通過率${a.p}→総合${a.o}（表では${TABLE[a.d + a.p]}）`); }
    }
    return { n, v, list };
  };
  const vA = viol("A"), vD = viol("D");
  // 軸ごとの一致（本人希望・通過率）
  const axisAgree = (k: "d" | "p") => {
    let n = 0, same = 0, up = 0, down = 0;
    const sc: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };
    for (const id of ids) {
      const a = out.A.get(id)?.axes, d = out.D.get(id)?.axes;
      if (!a || !d) continue;
      n++;
      if (a[k] === d[k]) same++; else if (sc[d[k]] > sc[a[k]]) up++; else down++;
    }
    return { n, same, up, down };
  };
  const brokenCount = (k: "A" | "D") => {
    const cnt: Record<string, number> = {};
    for (const id of ids) { const o = out[k].get(id); if (o?.broken) cnt[o.reason] = (cnt[o.reason] ?? 0) + 1; }
    return { n: Object.values(cnt).reduce((s, x) => s + x, 0), cnt };
  };
  const bA = brokenCount("A"), bD = brokenCount("D");

  const confTable = (ps: Pair[], rl: string, cl: string) => {
    const m: Record<string, Record<string, number>> = Object.fromEntries(RANKS.map((a) => [a, Object.fromEntries(RANKS.map((b) => [b, 0]))]));
    for (const q of ps) m[q.y][q.x]++;
    const lines = [`| ${rl} ＼ ${cl} | ${RANKS.join(" | ")} | 計 |`, `|--|${RANKS.map(() => "--:").join("|")}|--:|`];
    for (const y of RANKS) lines.push(`| ${y} | ${RANKS.map((x) => (x === y ? `**${m[y][x]}**` : String(m[y][x]))).join(" | ")} | ${RANKS.reduce((s, x) => s + m[y][x], 0)} |`);
    return lines.join("\n");
  };

  // 応答時間
  const latRows = lat.map((l) => ({ ...l, usd: usageUsd(l.model, l.usage, 1) }));
  const latAvg = (model: string) => {
    const xs = latRows.filter((l) => l.model === model);
    return xs.length ? xs.reduce((s, l) => s + l.ms, 0) / xs.length : NaN;
  };
  const latUsd = latRows.reduce((s, l) => s + l.usd, 0);

  const n = ids.length;
  const yenA = (cost.A / n) * JPY_PER_USD, yenD = (cost.D / n) * JPY_PER_USD;
  const testJpy = (cost.D + latUsd) * JPY_PER_USD;
  const baseExact = sAC.n ? sAC.exact / sAC.n : 0;
  const daExact = sDA.n ? sDA.exact / sDA.n : 0;
  const missRate = sDA.n ? miss / sDA.n : 0;
  const latA = latAvg(MODEL_A), latD = latAvg(MODEL_D);
  const judge = {
    agree: daExact >= 0.617,
    miss: missRate <= 0.03,
    table: vD.v <= 1,
    cost: yenD < yenA,
    latency: Number.isFinite(latD) && latD <= latA * 1.25,
  };

  const md: string[] = [];
  md.push(`## 第2部 集計（scripts/compare-opus55-t-xxx.ts report・${jst(new Date())} JST）`, "");
  md.push(`- 入力: step1 の plan.json（${st.inputCheck?.step1PlanCreatedAt} 作成）をそのまま使用。組み直しなし＝入力が変わった件数 0件`);
  md.push(`- 実施件数: ${n}件 / 候補者 ${new Set(sent.map((g) => g.candidateId)).size}人 / リクエスト ${sent.length}本${st.estimate?.droppedRequests.length ? `（予算で外した ${st.estimate.droppedRequests.join(",")}）` : ""}`);
  md.push(`- D の設定: model=${MODEL_D} / max_tokens=16000 / output_config.effort="${EFFORT_D}" / thinking 未指定（常に adaptive）/ temperature なし / system・messages・cache_control は本番と同一`);
  md.push(`- パラメータ確認（Opus 5.5 に本番の設定を送った結果）: ${Object.entries(st.paramProbe ?? {}).map(([k, v]) => `${k} → ${v}`).join(" / ")}`);
  md.push(`- 形式崩れ: A=${bA.n}件 ${JSON.stringify(bA.cnt)} / D=${bD.n}件 ${JSON.stringify(bD.cnt)}`);
  md.push(`- リクエスト失敗: ${reqErr.length ? reqErr.join(", ") : "なし"} / stop_reason A=${JSON.stringify(stops.A)} D=${JSON.stringify(stops.D)}`, "");
  md.push(`| 比較 | 件数 | 完全一致率 | 1段差以内率 | 上振れ/下振れ（左が右より） |`);
  md.push(`|--|--:|--:|--:|--|`);
  const row = (name: string, s: { n: number; exact: number; within1: number }, ps: Pair[]) => {
    const ud = upDown(ps);
    md.push(`| ${name} | ${s.n} | ${pct(s.exact, s.n)} | ${pct(s.within1, s.n)} | 上 ${ud.up} / 下 ${ud.down} |`);
  };
  row("（基準）A（Opus 4.6 再実行）vs C（過去の Opus）＝Opus のブレ", sAC, pAC);
  row("**D（Opus 5.5）vs A（Opus 4.6 再実行）**", sDA, pDA);
  row("**D（Opus 5.5）vs C（過去の Opus）**", sDC, pDC);
  row("（参考・厳しめ）D vs C 応募履歴更新も除外", agree(pDCs), pDCs);
  row("（参考・厳しめ）A vs C 応募履歴更新も除外", agree(pACs), pACs);
  md.push("");
  md.push(`- 取りこぼし（A が A/B+ なのに D が C/D）: **${miss}件**（比較${sDA.n}件中 ${pct(miss, sDA.n)}・A が A/B+ の${aHigh}件中 ${pct(miss, aHigh)}）/ 参考: C が A/B+ で D が C/D ${missDC}件`);
  md.push(`- 押し上げ（A が C/D なのに D が A/B+）: **${push}件**（比較${sDA.n}件中 ${pct(push, sDA.n)}・A が C/D の${aLow}件中 ${pct(push, aLow)}）`);
  md.push(`- 総合評価表の破り（本人希望×通過率の表と総合が食い違う）: A=${vA.v}件（3軸取得${vA.n}件）/ **D=${vD.v}件**（3軸取得${vD.n}件）`);
  for (const k of ["d", "p"] as const) {
    const s = axisAgree(k);
    md.push(`- ${k === "d" ? "本人希望" : "通過率"}の軸: D vs A 一致 ${s.same}/${s.n}（${pct(s.same, s.n)}）・D が高い ${s.up}・低い ${s.down}`);
  }
  if (vD.list.length) md.push(`- D の表破り: ${vD.list.join(" / ")}`);
  md.push("");
  md.push(`### 混同表 A（Opus 4.6 再実行・行）× D（Opus 5.5・列）`, "", confTable(pDA, "A", "D"), "");
  md.push(`### 参考: 混同表 C（過去の Opus・行）× D（Opus 5.5・列）`, "", confTable(pDC, "C", "D"), "");
  md.push(`### 費用（Batch API 50% 込み・同じ ${sent.length} リクエスト）`, "");
  md.push(`| | Opus 4.6（A・step1 実績） | Opus 5.5（D） |`);
  md.push(`|--|--:|--:|`);
  md.push(`| 入力合計（非キャッシュ+書込+読取） | ${(tok.A.in + tok.A.write + tok.A.read).toLocaleString()} | ${(tok.D.in + tok.D.write + tok.D.read).toLocaleString()} |`);
  md.push(`| うち非キャッシュ | ${tok.A.in.toLocaleString()} | ${tok.D.in.toLocaleString()} |`);
  md.push(`| うちキャッシュ書込 | ${tok.A.write.toLocaleString()} | ${tok.D.write.toLocaleString()} |`);
  md.push(`| うちキャッシュ読取 | ${tok.A.read.toLocaleString()} | ${tok.D.read.toLocaleString()} |`);
  md.push(`| 出力（考える工程を含む） | ${tok.A.out.toLocaleString()} | ${tok.D.out.toLocaleString()} |`);
  md.push(`| うち本文（count_tokens で推定） | ${tok.A.text.toLocaleString()} | ${tok.D.text.toLocaleString()} |`);
  md.push(`| うち考える工程（出力−本文・推定） | ${Math.max(0, tok.A.out - tok.A.text).toLocaleString()} | ${Math.max(0, tok.D.out - tok.D.text).toLocaleString()} |`);
  md.push(`| 実費 | $${cost.A.toFixed(3)}（¥${(cost.A * JPY_PER_USD).toFixed(0)}） | $${cost.D.toFixed(3)}（¥${(cost.D * JPY_PER_USD).toFixed(0)}） |`);
  md.push(`| 1件あたり | ¥${yenA.toFixed(2)} | ¥${yenD.toFixed(2)} |`, "");
  md.push(`- 同じ入力を Opus 5.5 が数えたトークン数: Opus 4.6 の ${((st.estimate?.tokenizerRatio ?? 0) * 100).toFixed(1)}%（count_tokens・21リクエスト合計）`);
  md.push(`- 本文の出力トークン: Opus 5.5 は Opus 4.6 の ${pct(tok.D.text, tok.A.text)} / 出力全体（考える工程込み）は ${pct(tok.D.out, tok.A.out)}`);
  md.push(`- 費用比 D/A = ${pct(cost.D, cost.A)}`, "");
  md.push(`### 応答時間（通常の送り方・非ストリーミング・同じ候補者の2リクエストを順に送信）`, "");
  md.push(`| モデル | リクエスト | 所要時間 | 出力 | キャッシュ読込 | キャッシュ書込 | stop_reason | 費用（割引なし） |`);
  md.push(`|--|--|--:|--:|--:|--:|--|--:|`);
  for (const l of latRows) md.push(`| ${l.model} | ${l.customId} | ${(l.ms / 1000).toFixed(1)}秒 | ${l.usage.output_tokens} | ${l.usage.cache_read_input_tokens ?? 0} | ${l.usage.cache_creation_input_tokens ?? 0} | ${l.stop_reason} | ¥${(l.usd * JPY_PER_USD).toFixed(1)} |`);
  md.push("");
  md.push(`- 平均: Opus 4.6 ${(latA / 1000).toFixed(1)}秒 / Opus 5.5 ${(latD / 1000).toFixed(1)}秒（${pct(latD, latA)}）`, "");
  md.push(`### テスト総費用`, "");
  md.push(`- Opus 5.5 まとめ送り ¥${(cost.D * JPY_PER_USD).toFixed(0)} ＋ 応答時間の計測 ¥${(latUsd * JPY_PER_USD).toFixed(0)} ＝ **¥${testJpy.toFixed(0)}** / 事前見積もり ¥${(st.estimate?.jpyTotal ?? 0).toFixed(0)}（差 ¥${(testJpy - (st.estimate?.jpyTotal ?? 0)).toFixed(0)}）`, "");
  md.push(`### 判定の目安（最終判断は将幸さん）`, "");
  md.push(`| 目安 | 結果 | 判定 |`);
  md.push(`|--|--|--|`);
  md.push(`| D vs A の完全一致率 61.7% 以上 | ${pct(sDA.exact, sDA.n)} | ${judge.agree ? "該当" : "非該当"} |`);
  md.push(`| 取りこぼし 3% 以下 | ${pct(miss, sDA.n)} | ${judge.miss ? "該当" : "非該当"} |`);
  md.push(`| 総合評価表の破りがほぼ 0（1件以下） | ${vD.v}件 | ${judge.table ? "該当" : "非該当"} |`);
  md.push(`| 1件あたり費用が Opus 4.6 より安い | ¥${yenD.toFixed(2)} vs ¥${yenA.toFixed(2)} | ${judge.cost ? "該当" : "非該当"} |`);
  md.push(`| 応答時間が大きく延びない（+25% 以内） | ${(latD / 1000).toFixed(1)}秒 vs ${(latA / 1000).toFixed(1)}秒 | ${judge.latency ? "該当" : "非該当"} |`);
  md.push(`| **切り替え候補** | | **${Object.values(judge).every(Boolean) ? "該当" : "非該当"}** |`);
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), md.join("\n"), "utf-8");

  // 明細 CSV（個人情報を含み得るためコミットしない）
  const csvEsc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const groupOf = new Map<string, string>();
  for (const g of sent) for (const id of g.fileIds) groupOf.set(id, g.customId);
  const csv = [["file_id", "candidate_id", "file_name", "custom_id", "C_past", "A_opus46", "D_opus55", "A_axes", "D_axes", "D_broken", "c_excluded"].join(",")];
  for (const id of ids) {
    const f = fileById.get(id)!;
    const a = out.A.get(id), d = out.D.get(id);
    csv.push([id, f.candidateId, f.fileName, groupOf.get(id), f.pastRating, a?.rating ?? "", d?.rating ?? "",
      a?.axes ? `${a.axes.d}/${a.axes.p}/${a.axes.o}` : "", d?.axes ? `${d.axes.d}/${d.axes.p}/${d.axes.o}` : "",
      d?.broken ? d.reason : "", f.changedAfterEval ? 1 : 0].map(csvEsc).join(","));
  }
  fs.writeFileSync(path.join(OUT_DIR, "detail.csv"), "﻿" + csv.join("\n"), "utf-8");

  // 読み比べ HTML（ずれ中心に10件）
  const both = ids.filter((id) => out.A.get(id)?.rating && out.D.get(id)?.rating);
  const diffOf = (id: string) => Math.abs(RANK_SCORE[out.A.get(id)!.rating!] - RANK_SCORE[out.D.get(id)!.rating!]);
  const mism = both.filter((id) => diffOf(id) > 0).sort((a, b) => diffOf(b) - diffOf(a));
  const brokenD = ids.filter((id) => out.D.get(id)?.broken);
  const pick = [...brokenD.slice(0, 2), ...mism].slice(0, 10);
  for (const id of both) if (pick.length < 10 && !pick.includes(id)) pick.push(id);
  const cards = pick.map((id) => {
    const f = fileById.get(id)!;
    const a = out.A.get(id)!, d = out.D.get(id)!;
    return `<section class="card"><h2>${esc(f.fileName)}</h2>
<p class="meta">file=${id} / 過去(C)=${esc(f.pastRatingRaw)} / Opus 4.6(A)=${a.rating ?? "形式崩れ"} / Opus 5.5(D)=${d.rating ?? `形式崩れ(${d.reason})`}${f.changedAfterEval ? " / C比較除外" : ""}</p>
<div class="cols"><div><h3>Opus 4.6（A）</h3><pre>${esc(a.comment)}</pre></div><div><h3>Opus 5.5（D）</h3><pre>${esc(d.comment)}</pre></div></div></section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opus 4.6 vs 5.5 読み比べ</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--card:#fafafa}
@media (prefers-color-scheme: dark){:root{--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--card:#1f1f1f}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}
.card{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:12px;margin:0 0 16px}
h2{font-size:15px;margin:0 0 4px}.meta{color:var(--muted);font-size:12px;margin:0 0 8px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.cols{grid-template-columns:1fr}}
pre{white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.55;margin:0}h3{font-size:13px;margin:0 0 4px}
</style></head><body><h1 style="font-size:18px">求人評価 Opus 4.6 vs Opus 5.5 読み比べ（${pick.length}件・ずれ優先）</h1>
${cards}</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, "compare.html"), html, "utf-8");

  console.log(md.join("\n"));
  console.log(`\n[report] ${OUT_DIR} に summary.md / detail.csv / compare.html を出力`);
}

// ---------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2] ?? "all";
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (cmd === "plan") return plan();
  if (cmd === "submit") return submit();
  if (cmd === "latency") return latency();
  if (cmd === "wait") return wait();
  if (cmd === "report" || cmd === "all") {
    if (cmd === "all") {
      await plan();
      await submit();
      await latency();
      await wait();
    }
    const libs = await loadLibs();
    try {
      await report(libs);
    } finally {
      await libs.prisma.$disconnect();
      await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
    }
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export {};

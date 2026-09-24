/**
 * T-XXX step3 第1部: 手動評価（analyze-batch）の費用内訳・キャッシュの効き方・やり直しの調査。
 *
 * 本番のコード・データは変えない読み取り専用スクリプト。AI 呼び出しはトークン計数（count_tokens・無料）のみ。
 *
 * やること:
 *   1-1. 直近30日の analyze-batch ログ（AdvisorUsageLog）から、1回の送信・1件あたりの
 *        入力（非キャッシュ／書き込み 5分・1時間／読み込み）と出力のトークン・金額の内訳を出す。
 *        ログには書き込みの TTL 別内訳の列が無いので、costUsd（TTL 別単価で計上済み）から 1時間分を逆算する。
 *        送信内容の部品（固定部 SKILL 等／候補者情報／指示文／求人票）の大きさは step1 の固定入力
 *        （scripts/output/t-xxx-eval-compare/plan.json・本番と同じ組み方）を count_tokens で測る（推定）。
 *   1-2. 呼び出し間隔の分布・同時送信の有無・固定部の想定外の書き込み・キャッシュを効かせた場合の試算。
 *   1-3. 評価のやり直し: ログの run（候補者ごとの batchIndex 0.. の並び）から、各 run が評価した
 *        ブックマークを本番の選び方（createdAt desc・未アーカイブ・extractedText あり）で復元し、
 *        同じ求人の2回目以降の評価と、その間に入力が変わっていないものを数える。
 *
 * 本番への影響ゼロの担保: DB は default_transaction_read_only=on を付けた接続（起動時に SHOW で確認）。
 *   本番 lib は prisma 以外 import しない。書き込み系の呼び出しなし。
 *
 * 出力（個人情報を含み得るためコミットしない）: scripts/output/t-xxx-opus55/survey-*.csv / survey-summary.md
 *
 * 実行（master worktree）:
 *   ANTHROPIC_API_KEY=... npx tsx --env-file=.env scripts/survey-eval-cost-t-xxx.ts
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join("scripts", "output", "t-xxx-opus55");
const STEP1_PLAN = path.join("scripts", "output", "t-xxx-eval-compare", "plan.json");
const WINDOW_DAYS = 30;
const JPY_PER_USD = 157.42; // step1 と同じ
const MODEL = "claude-opus-4-6";
// 公式料金（Opus 4.6・$/MTok）。5分書込=1.25x / 1時間書込=2x / 読込=0.1x
const P = { input: 5, output: 25, w5m: 6.25, w1h: 10, read: 0.5 };
const TTL_5M = 5 * 60_000;
const TTL_1H = 60 * 60_000;
// run の区切り: 同じ候補者で batchIndex が 0 に戻る、または前の呼び出しから30分超（route の runContextCache と同じ）
const RUN_GAP_MS = 30 * 60_000;

type Log = {
  id: string;
  createdAt: Date;
  endpoint: string;
  candidateId: string | null;
  batchIndex: number | null;
  batchTotal: number | null;
  fileCount: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  isRetry: boolean;
  note: string | null;
};

function jst(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
}
const yen = (usd: number) => `¥${Math.round(usd * JPY_PER_USD).toLocaleString()}`;
const yen2 = (usd: number) => `¥${(usd * JPY_PER_USD).toFixed(2)}`;
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
function quant(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(0)}秒` : "-");

async function loadPrisma() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未設定（npx tsx --env-file=.env で実行）");
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
  const { prisma } = await import("@/lib/prisma");
  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("SHOW default_transaction_read_only");
  if (ro[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用接続になっていないため中止");
  return prisma;
}

// 1時間書込トークンを costUsd から逆算（recordAdvisorUsage は TTL 別内訳がある場合 5分=6.25 / 1時間=10 で計上）
function split1h(l: Log): { w5m: number; w1h: number; residualUsd: number } {
  const W = l.cacheCreationTokens;
  const base = (l.inputTokens * P.input + l.outputTokens * P.output + l.cacheReadTokens * P.read + W * P.w5m) / 1e6;
  const extra = l.costUsd - base; // = w1h × (10−6.25) / 1e6
  let w1h = Math.round((extra * 1e6) / (P.w1h - P.w5m));
  w1h = Math.max(0, Math.min(W, w1h));
  const w5m = W - w1h;
  const recomputed = (l.inputTokens * P.input + l.outputTokens * P.output + l.cacheReadTokens * P.read + w5m * P.w5m + w1h * P.w1h) / 1e6;
  return { w5m, w1h, residualUsd: l.costUsd - recomputed };
}

async function measureSegments() {
  // step1 の固定入力（本番と同じ組み方の21リクエスト）で部品ごとの大きさを測る（count_tokens・無料）
  if (!fs.existsSync(STEP1_PLAN)) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan: any = JSON.parse(fs.readFileSync(STEP1_PLAN, "utf-8"));
  const tiny = [{ role: "user" as const, content: "。" }];
  const count = async (system: unknown[] | undefined, messages: { role: "user"; content: string }[]) =>
    (
      await client.messages.countTokens({
        model: MODEL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(system ? { system: system as any } : {}),
        messages,
      })
    ).input_tokens;
  const base = await count(undefined, tiny);
  const fixedBlock = plan.groups[0].system[0];
  const fixed = (await count([fixedBlock], tiny)) - base;
  const ctx: number[] = [];
  const instr: number[] = [];
  const jobs: number[] = [];
  const perJob: number[] = [];
  const totals: number[] = [];
  const seenCand = new Set<string>();
  for (const g of plan.groups) {
    const withCtx = await count(g.system.slice(0, 2), tiny);
    const all = await count(g.system, tiny);
    const full = await count(g.system, g.messages);
    if (!seenCand.has(g.candidateId)) {
      ctx.push(withCtx - base - fixed);
      seenCand.add(g.candidateId);
    }
    instr.push(all - withCtx);
    jobs.push(full - all + base);
    if (g.fileIds.length === 5) perJob.push((full - all + base) / 5);
    totals.push(full);
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  return {
    fixed,
    ctxAvg: avg(ctx),
    ctxMin: Math.min(...ctx),
    ctxMax: Math.max(...ctx),
    instrAvg: avg(instr),
    jobsPer5: avg(jobs.filter((_, i) => plan.groups[i].fileIds.length === 5)),
    perJobAvg: avg(perJob),
    totalAvg: avg(totals),
    candidates: seenCand.size,
    requests: plan.groups.length,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const prisma = await loadPrisma();
  const md: string[] = [];
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400_000);
  try {
    md.push(`# 第1部 集計（scripts/survey-eval-cost-t-xxx.ts・${jst(now)} JST）`, "");
    md.push(`- 対象: AdvisorUsageLog ${jst(since)} 〜 ${jst(now)}（JST）`, "");

    const logsAll = (await prisma.advisorUsageLog.findMany({
      where: { createdAt: { gte: since }, endpoint: { in: ["analyze-batch", "recommend-analyze"] } },
      orderBy: { createdAt: "asc" },
    })) as unknown as Log[];
    const manual = logsAll.filter((l) => l.endpoint === "analyze-batch");
    const ok = manual.filter((l) => !(l.note ?? "").startsWith("error-"));
    const errors = manual.filter((l) => (l.note ?? "").startsWith("error-"));

    // ------------------------------------------------ 1-1 内訳（実測）
    const seg = await measureSegments();
    const F = seg?.fixed ?? 21308; // 計数できない場合は T-189 報告書の値
    let sumIn = 0, sumOut = 0, sumRead = 0, sumW5 = 0, sumW1 = 0, sumCost = 0, sumFiles = 0, maxResid = 0;
    const rows: {
      l: Log; w5m: number; w1h: number; fixedState: "read" | "write" | "none"; ctxRead: number; ctxWrite: number;
    }[] = [];
    for (const l of ok) {
      const s = split1h(l);
      maxResid = Math.max(maxResid, Math.abs(s.residualUsd));
      sumIn += l.inputTokens; sumOut += l.outputTokens; sumRead += l.cacheReadTokens;
      sumW5 += s.w5m; sumW1 += s.w1h; sumCost += l.costUsd; sumFiles += l.fileCount ?? 0;
      // 部品への割り当て: 1時間書込=固定部 / 読込のうち固定部の大きさまで=固定部（1h書込が無い時）/ 残り=候補者情報
      const fixedRead = s.w1h === 0 && l.cacheReadTokens >= F * 0.9;
      const fixedState = s.w1h > 0 ? "write" : fixedRead ? "read" : "none";
      rows.push({
        l, w5m: s.w5m, w1h: s.w1h, fixedState,
        ctxRead: fixedRead ? l.cacheReadTokens - F : l.cacheReadTokens,
        ctxWrite: s.w5m,
      });
    }
    const usd = {
      in: (sumIn * P.input) / 1e6, out: (sumOut * P.output) / 1e6, read: (sumRead * P.read) / 1e6,
      w5: (sumW5 * P.w5m) / 1e6, w1: (sumW1 * P.w1h) / 1e6,
    };
    const recomputedTotal = usd.in + usd.out + usd.read + usd.w5 + usd.w1;
    const calls = ok.length;
    md.push(`## 1-1 手動評価（analyze-batch）の内訳（ログ実測）`, "");
    md.push(`- 成功した送信 ${calls}回 / 評価件数 ${sumFiles}件（1回あたり ${(sumFiles / calls).toFixed(2)}件）/ 失敗ログ ${errors.length}回（${[...new Set(errors.map((e) => e.note))].join(",")}）`);
    md.push(`- ログの費用合計 $${sumCost.toFixed(2)}（${yen(sumCost)}）/ 公式単価で再計算 $${recomputedTotal.toFixed(2)}（1回あたりの差の最大 $${maxResid.toFixed(6)}）`);
    md.push(`- 1件あたり ${yen2(sumCost / sumFiles)} / 1回あたり ${yen2(sumCost / calls)}`, "");
    md.push(`| 区分 | トークン計 | 1回あたり | 1件あたり | 金額 | 1件あたり金額 | 割合 |`);
    md.push(`|--|--:|--:|--:|--:|--:|--:|`);
    const line = (name: string, tok: number, u: number) =>
      md.push(`| ${name} | ${tok.toLocaleString()} | ${Math.round(tok / calls).toLocaleString()} | ${Math.round(tok / sumFiles).toLocaleString()} | ${yen(u)} | ${yen2(u / sumFiles)} | ${pct(u, recomputedTotal)} |`);
    line("入力・通常（非キャッシュ）", sumIn, usd.in);
    line("入力・キャッシュ書込 1時間（2x）", sumW1, usd.w1);
    line("入力・キャッシュ書込 5分（1.25x）", sumW5, usd.w5);
    line("入力・キャッシュ読込（0.1x）", sumRead, usd.read);
    line("出力", sumOut, usd.out);
    md.push(`| 計 | | | | ${yen(recomputedTotal)} | ${yen2(recomputedTotal / sumFiles)} | 100% |`, "");

    // 最終バッチ（総合まとめ・過去バッチ結果を同梱）とそれ以外
    const grp = (f: (l: Log) => boolean) => {
      const xs = ok.filter(f);
      const c = xs.reduce((s, l) => s + l.costUsd, 0);
      const n = xs.reduce((s, l) => s + (l.fileCount ?? 0), 0);
      const o = xs.reduce((s, l) => s + l.outputTokens, 0);
      const i = xs.reduce((s, l) => s + l.inputTokens, 0);
      return { calls: xs.length, files: n, usd: c, out: o, inp: i };
    };
    const gl = grp((l) => l.note === "last-batch");
    const gm = grp((l) => l.note !== "last-batch");
    const gRetry = grp((l) => l.isRetry);
    const gSingle = grp((l) => l.batchTotal === 1);
    md.push(`| 送信の種類 | 回数 | 件数 | 費用 | 1件あたり | 1回あたり出力 | 1回あたり非キャッシュ入力 |`);
    md.push(`|--|--:|--:|--:|--:|--:|--:|`);
    for (const [n, g] of [["最終バッチ（総合まとめ付き）", gl], ["中間バッチ", gm], ["うち1バッチだけの run", gSingle], ["未評価/破損のみ（再実行）", gRetry]] as const) {
      md.push(`| ${n} | ${g.calls} | ${g.files} | ${yen(g.usd)} | ${yen2(g.usd / Math.max(1, g.files))} | ${Math.round(g.out / Math.max(1, g.calls)).toLocaleString()} | ${Math.round(g.inp / Math.max(1, g.calls)).toLocaleString()} |`);
    }
    md.push("");

    if (seg) {
      md.push(`### 送信内容の部品の大きさ（推定: step1 の固定入力 ${seg.requests}リクエスト・${seg.candidates}人を ${MODEL} の count_tokens で計数）`, "");
      md.push(`| 部品 | トークン | キャッシュ指定 |`);
      md.push(`|--|--:|--|`);
      md.push(`| ① 固定部（SKILL.md＋middle-career.md＋評価ルール） | ${seg.fixed.toLocaleString()} | 1時間 |`);
      md.push(`| ② 候補者情報（平均・最小〜最大） | ${Math.round(seg.ctxAvg).toLocaleString()}（${seg.ctxMin.toLocaleString()}〜${seg.ctxMax.toLocaleString()}） | 5分 |`);
      md.push(`| ③ バッチ指示文 | ${Math.round(seg.instrAvg).toLocaleString()} | なし |`);
      md.push(`| ④ 求人票5件（user） | ${Math.round(seg.jobsPer5).toLocaleString()}（1件 ${Math.round(seg.perJobAvg).toLocaleString()}） | なし |`);
      md.push(`| 1回の合計（平均） | ${Math.round(seg.totalAvg).toLocaleString()} | |`, "");
    }

    // 部品別の費用（ログの書込/読込を部品に割り当て）
    const fixedStates = { read: 0, write: 0, none: 0 };
    let fixedUsd = 0, ctxUsd = 0;
    for (const r of rows) {
      fixedStates[r.fixedState]++;
      if (r.fixedState === "write") fixedUsd += (r.w1h * P.w1h) / 1e6;
      if (r.fixedState === "read") fixedUsd += (F * P.read) / 1e6;
      ctxUsd += (r.ctxWrite * P.w5m + Math.max(0, r.ctxRead) * P.read) / 1e6;
    }
    md.push(`### 部品別の費用（ログの書込・読込を部品に割り当て。1時間書込=①、5分書込=②、読込は①の大きさまで①・残り②）`, "");
    md.push(`| 部品 | 30日の費用 | 1件あたり | 割合 |`);
    md.push(`|--|--:|--:|--:|`);
    md.push(`| ① 固定部（書込 ${fixedStates.write}回 / 読込 ${fixedStates.read}回 / どちらでもない ${fixedStates.none}回） | ${yen(fixedUsd)} | ${yen2(fixedUsd / sumFiles)} | ${pct(fixedUsd, recomputedTotal)} |`);
    md.push(`| ② 候補者情報（キャッシュ分） | ${yen(ctxUsd)} | ${yen2(ctxUsd / sumFiles)} | ${pct(ctxUsd, recomputedTotal)} |`);
    md.push(`| ③④ 指示文＋求人票＋（最終バッチの）過去結果＝非キャッシュ | ${yen(usd.in)} | ${yen2(usd.in / sumFiles)} | ${pct(usd.in, recomputedTotal)} |`);
    md.push(`| 出力 | ${yen(usd.out)} | ${yen2(usd.out / sumFiles)} | ${pct(usd.out, recomputedTotal)} |`, "");

    // ------------------------------------------------ 1-2 間隔・同時送信
    // run の復元
    // 画面の呼び方では「中間バッチは必ず5件」。中間バッチで5件未満の呼び出しは画面以外（検証スクリプトの batchSize 指定等）とみなす。
    const isAnomaly = (l: Log) => !l.isRetry && l.note !== "last-batch" && (l.fileCount ?? 0) < 5;
    type Run = { candidateId: string; calls: Log[]; isRetry: boolean; anomaly: boolean };
    const runs: Run[] = [];
    const lastRunOf = new Map<string, Run>();
    for (const l of manual) {
      if (!l.candidateId) continue;
      if (isAnomaly(l)) {
        const prevA = lastRunOf.get(l.candidateId);
        if (prevA?.anomaly) prevA.calls.push(l);
        else {
          const r: Run = { candidateId: l.candidateId, calls: [l], isRetry: l.isRetry, anomaly: true };
          runs.push(r);
          lastRunOf.set(l.candidateId, r);
        }
        continue;
      }
      const prev = lastRunOf.get(l.candidateId);
      const prevCall = prev?.calls[prev.calls.length - 1];
      const newRun =
        !prev || prev.anomaly || (l.batchIndex ?? 0) === 0 || !prevCall || l.createdAt.getTime() - prevCall.createdAt.getTime() > RUN_GAP_MS ||
        (l.batchIndex ?? 0) <= (prevCall.batchIndex ?? 0);
      if (newRun) {
        const r: Run = { candidateId: l.candidateId, calls: [l], isRetry: l.isRetry, anomaly: false };
        runs.push(r);
        lastRunOf.set(l.candidateId, r);
      } else prev!.calls.push(l);
    }
    // 同じ run の連続バッチ間隔（= 次の送信の応答時間 + 2秒待ち + 画面の再取得）
    const inRunGaps: number[] = [];
    for (const r of runs) if (!r.anomaly) for (let i = 1; i < r.calls.length; i++) inRunGaps.push(r.calls[i].createdAt.getTime() - r.calls[i - 1].createdAt.getTime());
    // 同じ候補者の run 間隔（前の run の最後 → 次の run の最初）
    const byCand = new Map<string, Run[]>();
    for (const r of runs) {
      if (!byCand.has(r.candidateId)) byCand.set(r.candidateId, []);
      byCand.get(r.candidateId)!.push(r);
    }
    const crossRunGaps: number[] = [];
    for (const rsAll of byCand.values()) { const rs = rsAll.filter((r) => !r.anomaly); for (let i = 1; i < rs.length; i++) crossRunGaps.push(rs[i].calls[0].createdAt.getTime() - rs[i - 1].calls[rs[i - 1].calls.length - 1].createdAt.getTime()); }
    // 評価呼び出し全体（手動＋自動）で、前の呼び出しからの間隔（固定部 1時間キャッシュの共有の目安）
    const globalGaps: number[] = [];
    for (let i = 1; i < manual.length; i++) {
      const t = manual[i].createdAt.getTime();
      const prevAny = logsAll.filter((x) => x.createdAt.getTime() < t).pop();
      if (prevAny) globalGaps.push(t - prevAny.createdAt.getTime());
    }
    // 同時送信: 同じ候補者で間隔 15秒未満（1回の応答は数十秒かかるため、逐次送信ではありえない）
    const concurrentSame: number[] = [];
    for (const rs of byCand.values()) {
      const cs = rs.filter((r) => !r.anomaly).flatMap((r) => r.calls).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 1; i < cs.length; i++) {
        const d = cs[i].createdAt.getTime() - cs[i - 1].createdAt.getTime();
        if (d < 15_000) concurrentSame.push(d);
      }
    }
    const dist = (xs: number[], name: string) => {
      const b = (lo: number, hi: number) => xs.filter((x) => x >= lo && x < hi).length;
      md.push(`| ${name} | ${xs.length} | ${sec(quant(xs, 0.5))} | ${sec(quant(xs, 0.9))} | ${pct(b(0, TTL_5M), xs.length)} | ${pct(b(TTL_5M, TTL_1H), xs.length)} | ${pct(b(TTL_1H, Infinity), xs.length)} |`);
    };
    md.push(`## 1-2 使い回し（キャッシュ）の効き方`, "");
    const an = runs.filter((r) => r.anomaly).flatMap((r) => r.calls);
    md.push(`- 画面以外の呼び方（中間バッチなのに5件未満＝検証スクリプト等）: ${an.length}回 / ${an.reduce((s2, l) => s2 + (l.fileCount ?? 0), 0)}件 / ${yen(an.reduce((s2, l) => s2 + l.costUsd, 0))}（日付: ${[...new Set(an.map((l) => jst(l.createdAt).slice(0, 10)))].join(", ")}）`);
    md.push(`- run（候補者ごとの一続きの評価）${runs.length}本 / うち複数バッチ ${runs.filter((r) => r.calls.length > 1).length}本 / 未評価・破損のみ ${runs.filter((r) => r.isRetry).length}本`);
    md.push(`- 同じ候補者の送信どうしが15秒未満で並んだもの（同時送信の疑い）: ${concurrentSame.length}組${concurrentSame.length ? `（間隔 ${concurrentSame.map((x) => `${(x / 1000).toFixed(1)}s`).join(", ")}）` : ""}`, "");
    md.push(`| 間隔 | 組数 | 中央値 | 90%点 | 5分未満 | 5分〜1時間 | 1時間以上 |`);
    md.push(`|--|--:|--:|--:|--:|--:|--:|`);
    dist(inRunGaps, "同じ run の連続バッチ（ほぼ応答時間+2秒）");
    dist(crossRunGaps, "同じ候補者の run と run の間");
    dist(globalGaps, "評価（手動＋自動）全体の直前の呼び出しから");
    md.push("");

    // 固定部の想定外の書込: 直前1時間以内（かつ20秒以上前＝前の送信は完了済み）に評価呼び出しがあったのに1時間書込が起きた回
    let unexpected1h = 0, expected1h = 0;
    const unexpectedGaps: number[] = [];
    for (const r of rows) {
      if (r.w1h === 0) continue;
      const t = r.l.createdAt.getTime();
      const prevAny = logsAll.filter((x) => x.createdAt.getTime() < t - 0).pop();
      const g = prevAny ? t - prevAny.createdAt.getTime() : Infinity;
      if (g < TTL_1H) { unexpected1h++; unexpectedGaps.push(g); } else expected1h++;
    }
    // 候補者情報の書込: run の2バッチ目以降で5分書込が起きた回
    let ctxWriteLater = 0, ctxReadLater = 0, laterCalls = 0;
    for (const r of runs) for (let i = 1; i < r.calls.length; i++) {
      laterCalls++;
      const row = rows.find((x) => x.l.id === r.calls[i].id);
      if (!row) continue;
      if (row.ctxWrite > 500) ctxWriteLater++;
      if (row.ctxRead > 500) ctxReadLater++;
    }
    md.push(`- ① 固定部の1時間書込 ${expected1h + unexpected1h}回: 直前1時間に評価呼び出しが無かった（正当）${expected1h}回 / あったのに書込（想定外）${unexpected1h}回（直前との間隔 中央値 ${sec(quant(unexpectedGaps, 0.5))}）`);
    md.push(`- ② 候補者情報: run の2バッチ目以降 ${laterCalls}回のうち 読込あり ${ctxReadLater}回 / 書込あり ${ctxWriteLater}回`, "");

    // 試算
    // S1: 固定部は直前1時間に評価呼び出しがあれば読込、無ければ1時間書込（同時送信はしない前提）。②以降は実績どおり。
    // S2: S1 ＋ 候補者情報は run の1回目だけ書込・2回目以降は読込（同じ候補者の run 間が5分以内なら1回目も読込）。
    // S3: S2 ＋ 候補者情報を1時間 TTL にした場合（run 間が1時間以内なら読込。書込は2x）。
    const sim = (mode: "S1" | "S2" | "S3") => {
      let total = 0;
      for (const run of runs) {
        const rsC = byCand.get(run.candidateId)!;
        const idx = rsC.indexOf(run);
        const prevRunEnd = idx > 0 ? rsC[idx - 1].calls[rsC[idx - 1].calls.length - 1].createdAt.getTime() : -Infinity;
        run.calls.forEach((l, i) => {
          const row = rows.find((x) => x.l.id === l.id);
          if (!row) return; // error calls
          const t = l.createdAt.getTime();
          const prevAny = logsAll.filter((x) => x.createdAt.getTime() < t).pop();
          const g = prevAny ? t - prevAny.createdAt.getTime() : Infinity;
          const fixedUsdSim = g < TTL_1H ? (F * P.read) / 1e6 : (F * P.w1h) / 1e6;
          // 実績の候補者情報トークン（書込＋読込の②分）
          const ctxTok = row.ctxWrite + Math.max(0, row.ctxRead);
          let ctxSim: number;
          if (mode === "S1") ctxSim = (row.ctxWrite * P.w5m + Math.max(0, row.ctxRead) * P.read) / 1e6;
          else {
            const firstGap = run.calls[0].createdAt.getTime() - prevRunEnd;
            const ttl = mode === "S3" ? TTL_1H : TTL_5M;
            const readable = i > 0 || firstGap < ttl;
            ctxSim = readable ? (ctxTok * P.read) / 1e6 : (ctxTok * (mode === "S3" ? P.w1h : P.w5m)) / 1e6;
          }
          // 固定部の大きさを超えた分の非キャッシュ入力（固定部が未キャッシュ扱いだった回）を差し引く
          const fixedAsUncached = row.fixedState === "none" ? Math.min(l.inputTokens, F) : 0;
          const uncached = ((l.inputTokens - fixedAsUncached) * P.input) / 1e6;
          total += fixedUsdSim + ctxSim + uncached + (l.outputTokens * P.output) / 1e6;
        });
      }
      return total;
    };
    const s1 = sim("S1"), s2 = sim("S2"), s3 = sim("S3");
    md.push(`| 試算（直近30日の手動評価を置き換え） | 30日の費用 | 1件あたり | 実績との差 |`);
    md.push(`|--|--:|--:|--:|`);
    md.push(`| 実績 | ${yen(recomputedTotal)} | ${yen2(recomputedTotal / sumFiles)} | - |`);
    md.push(`| S1: ①固定部を1時間キャッシュで全員共有（想定外の書込ゼロ） | ${yen(s1)} | ${yen2(s1 / sumFiles)} | ${yen(s1 - recomputedTotal)} |`);
    md.push(`| S2: S1＋②候補者情報を run の1回目で書込・残りは読込 | ${yen(s2)} | ${yen2(s2 / sumFiles)} | ${yen(s2 - recomputedTotal)} |`);
    md.push(`| （参考）S3: S2＋②を1時間 TTL（書込2x） | ${yen(s3)} | ${yen2(s3 / sumFiles)} | ${yen(s3 - recomputedTotal)} |`);
    md.push(`| （参考）理論下限: ①②が全回読込（書込ゼロ） | ${yen(usd.in + usd.out + ((sumRead + sumW1 + sumW5) * P.read) / 1e6)} | ${yen2((usd.in + usd.out + ((sumRead + sumW1 + sumW5) * P.read) / 1e6) / sumFiles)} | ${yen(usd.in + usd.out + ((sumRead + sumW1 + sumW5) * P.read) / 1e6 - recomputedTotal)} |`, "");

    // ------------------------------------------------ 1-3 やり直し
    const candIds = [...byCand.keys()];
    const bms = await prisma.candidateFile.findMany({
      where: { candidateId: { in: candIds }, category: "BOOKMARK" },
      select: { id: true, candidateId: true, createdAt: true, extractedAt: true, extractedText: false, archivedAt: true, autoSourcedAt: true, aiAnalyzedAt: true },
    });
    const hasText = await prisma.candidateFile.findMany({
      where: { candidateId: { in: candIds }, category: "BOOKMARK", extractedText: { not: null } },
      select: { id: true },
    });
    const textIds = new Set(hasText.map((x) => x.id));
    const bmByCand = new Map<string, typeof bms>();
    for (const b of bms) {
      if (!textIds.has(b.id)) continue;
      if (!bmByCand.has(b.candidateId)) bmByCand.set(b.candidateId, []);
      bmByCand.get(b.candidateId)!.push(b);
    }
    const [docs, notes, guides, cands, entries] = await Promise.all([
      prisma.candidateFile.findMany({ where: { candidateId: { in: candIds }, category: { not: "BOOKMARK" } }, select: { candidateId: true, createdAt: true, parsedAt: true } }),
      prisma.candidateNote.findMany({ where: { candidateId: { in: candIds } }, select: { candidateId: true, createdAt: true, updatedAt: true } }),
      prisma.guideEntry.findMany({ where: { candidateId: { in: candIds }, guideType: "INTERVIEW" }, select: { candidateId: true, updatedAt: true } }),
      prisma.candidate.findMany({ where: { id: { in: candIds } }, select: { id: true, advisorLogDigestUpdatedAt: true } }),
      prisma.jobEntry.findMany({ where: { candidateId: { in: candIds } }, select: { candidateId: true, createdAt: true, updatedAt: true } }),
    ]);
    const groupBy = <T extends { candidateId: string }>(xs: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of xs) { if (!m.has(x.candidateId)) m.set(x.candidateId, []); m.get(x.candidateId)!.push(x); }
      return m;
    };
    const docsBy = groupBy(docs), notesBy = groupBy(notes), guidesBy = groupBy(guides), entriesBy = groupBy(entries);
    const digestBy = new Map(cands.map((c) => [c.id, c.advisorLogDigestUpdatedAt]));

    // run ごとの対象ブックマークを復元
    type Ev = { fileId: string; candidateId: string; at: Date; usd: number; runKind: string; auto: boolean };
    const evs: Ev[] = [];
    const runKinds: Record<string, { runs: number; files: number; usd: number }> = {};
    let repeatedFirstBatch = 0, repeatedFirstBatchUsd = 0;
    for (const run of runs) {
      const okCalls = run.calls.filter((l) => !(l.note ?? "").startsWith("error-"));
      const files = okCalls.reduce((s, l) => s + (l.fileCount ?? 0), 0);
      const usdRun = okCalls.reduce((s, l) => s + l.costUsd, 0);
      // 全件分析も追加分析も、route は対象を createdAt desc で並べて先頭から5件ずつ切る。
      // よって（未評価/破損のみ以外の）run が評価したのは「その時点の対象ブックマークの新しい順 先頭 files 件」。
      // 1回目のログは1回目の応答後に書かれるので、送信開始は約2分前。
      const eligibleAt = (t: Date) =>
        (bmByCand.get(run.candidateId) ?? [])
          .filter((b) => b.createdAt <= t && (!b.archivedAt || b.archivedAt > run.calls[0].createdAt))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      let list = eligibleAt(new Date(run.calls[0].createdAt.getTime() - 120_000));
      if (list.length < files) list = eligibleAt(run.calls[0].createdAt);
      const completed = run.calls.some((l) => l.note === "last-batch");
      let kind: string;
      let target: typeof list = [];
      if (run.anomaly) kind = "検証スクリプト等（画面操作ではない呼び方）";
      else if (run.isRetry) kind = "未評価/破損のみ";
      else if (list.length < files) kind = "復元不可（その後削除された等）";
      else {
        target = list.slice(0, files);
        kind = !completed ? "途中で止まった run" : files === list.length ? "全件分析" : "追加分析（新しい分のみ）";
      }
      // 直前の run が同じ候補者で1バッチ目だけ・最終バッチ無しで止まり、すぐ（10分以内）押し直したもの
      const rsC = byCand.get(run.candidateId)!;
      const idx = rsC.indexOf(run);
      if (idx > 0) {
        const pr = rsC[idx - 1];
        const gap = run.calls[0].createdAt.getTime() - pr.calls[pr.calls.length - 1].createdAt.getTime();
        if (!pr.anomaly && !pr.calls.some((l) => l.note === "last-batch") && gap < 10 * 60_000) {
          repeatedFirstBatch++;
          repeatedFirstBatchUsd += pr.calls.reduce((s, l) => s + l.costUsd, 0);
        }
      }
      runKinds[kind] ??= { runs: 0, files: 0, usd: 0 };
      runKinds[kind].runs++; runKinds[kind].files += files; runKinds[kind].usd += usdRun;
      if (target.length) {
        // 各ファイルの費用 = そのファイルが入ったバッチの費用 / バッチ件数
        let idx = 0;
        for (const l of okCalls.sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0))) {
          const n = l.fileCount ?? 0;
          for (let k = 0; k < n && idx < target.length; k++, idx++) {
            evs.push({ fileId: target[idx].id, candidateId: run.candidateId, at: l.createdAt, usd: l.costUsd / Math.max(1, n), runKind: kind, auto: !!target[idx].autoSourcedAt });
          }
        }
      }
    }
    md.push(`## 1-3 評価のやり直し`, "");
    md.push(`| run の種類（ログから復元） | run 数 | 評価件数 | 費用 |`);
    md.push(`|--|--:|--:|--:|`);
    for (const [k, v] of Object.entries(runKinds).sort((a, b) => b[1].usd - a[1].usd)) md.push(`| ${k} | ${v.runs} | ${v.files} | ${yen(v.usd)} |`);
    md.push("");

    const evByFile = new Map<string, Ev[]>();
    for (const e of evs) { if (!evByFile.has(e.fileId)) evByFile.set(e.fileId, []); evByFile.get(e.fileId)!.push(e); }
    const bmById = new Map(bms.map((b) => [b.id, b]));
    let reFiles = 0, reEvals = 0, reUsd = 0;
    let sameLoose = 0, sameLooseUsd = 0, sameStrict = 0, sameStrictUsd = 0;
    const reasonCnt: Record<string, number> = {};
    const csv: string[] = ["file_id,candidate_id,eval_at_jst,prev_eval_at_jst,usd,run_kind,auto,changed_loose,changed_strict,reasons"];
    for (const [fid, list] of evByFile) {
      list.sort((a, b) => a.at.getTime() - b.at.getTime());
      if (list.length < 2) continue;
      reFiles++;
      for (let i = 1; i < list.length; i++) {
        const e = list[i];
        const prev = list[i - 1].at;
        reEvals++; reUsd += e.usd;
        const within = (d: Date | null | undefined) => !!d && d > prev && d <= e.at;
        const reasons: string[] = [];
        const bm = bmById.get(fid);
        if (within(bm?.extractedAt)) reasons.push("求人本文");
        if ((docsBy.get(e.candidateId) ?? []).some((d) => within(d.createdAt) || within(d.parsedAt))) reasons.push("書類");
        if (within(digestBy.get(e.candidateId))) reasons.push("面談ログ要約");
        if ((notesBy.get(e.candidateId) ?? []).some((n) => within(n.createdAt) || within(n.updatedAt))) reasons.push("CAメモ");
        if ((guidesBy.get(e.candidateId) ?? []).some((g) => within(g.updatedAt))) reasons.push("面談ガイド");
        const loose = reasons.length > 0;
        // 厳しめ: 候補者情報に入る応募履歴・ファイル一覧（ブックマーク追加・アーカイブ含む）の変化も「変わった」とみなす
        const strictReasons = [...reasons];
        if ((entriesBy.get(e.candidateId) ?? []).some((x) => within(x.createdAt) || within(x.updatedAt))) strictReasons.push("応募履歴");
        if ((bmByCand.get(e.candidateId) ?? []).some((b) => within(b.createdAt) || within(b.archivedAt))) strictReasons.push("ブックマーク一覧");
        const strict = strictReasons.length > 0;
        for (const r of strictReasons) reasonCnt[r] = (reasonCnt[r] ?? 0) + 1;
        if (!loose) { sameLoose++; sameLooseUsd += e.usd; }
        if (!strict) { sameStrict++; sameStrictUsd += e.usd; }
        csv.push([fid, e.candidateId, jst(e.at), jst(prev), e.usd.toFixed(5), e.runKind, e.auto ? 1 : 0, loose ? 1 : 0, strict ? 1 : 0, strictReasons.join("/")].join(","));
      }
    }
    const tracked = evs.length;
    const trackedUsd = evs.reduce((s, e) => s + e.usd, 0);
    md.push(`- 最終バッチまで届かずに止まった run の直後10分以内に同じ候補者で押し直した回数: ${repeatedFirstBatch}回（止まった側の費用 ${yen(repeatedFirstBatchUsd)}）`);
    md.push(`- ブックマーク単位まで復元できた評価: ${tracked}件（${yen(trackedUsd)}）＝手動評価 ${sumFiles}件の ${pct(tracked, sumFiles)}`);
    md.push(`- うち、同じ求人が30日内に2回以上評価されたもの: ${reFiles}求人 / 2回目以降の評価 ${reEvals}回 / ${yen(reUsd)}`);
    md.push(`- そのうち前回から入力が変わっていないもの:`);
    md.push(`  - 指示の定義（求人本文・書類・面談ログ要約・CAメモ・面談ガイドに更新なし）: **${sameLoose}回 / ${yen(sameLooseUsd)}**`);
    md.push(`  - 厳しめ（上記＋応募履歴・ブックマーク一覧〔候補者情報のファイル一覧に出る〕も不変）: **${sameStrict}回 / ${yen(sameStrictUsd)}**`);
    md.push(`- 変わった理由の内訳（重複あり）: ${Object.entries(reasonCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("・")}`);
    const scale = sumFiles / Math.max(1, tracked);
    md.push(`- 復元できなかった評価も同じ割合と仮定した30日換算: 指示の定義 ${yen(sameLooseUsd * scale)} / 厳しめ ${yen(sameStrictUsd * scale)}`, "");
    fs.writeFileSync(path.join(OUT_DIR, "survey-reeval.csv"), "﻿" + csv.join("\n"), "utf-8");

    // 呼び出し明細（ID のみ）
    const callCsv = ["log_id,created_at_jst,candidate_id,batch_index,batch_total,file_count,is_retry,note,input,output,read,write5m,write1h,fixed_state,cost_usd"];
    for (const r of rows) callCsv.push([r.l.id, jst(r.l.createdAt), r.l.candidateId, r.l.batchIndex, r.l.batchTotal, r.l.fileCount, r.l.isRetry ? 1 : 0, r.l.note ?? "", r.l.inputTokens, r.l.outputTokens, r.l.cacheReadTokens, r.w5m, r.w1h, r.fixedState, r.l.costUsd.toFixed(5)].join(","));
    fs.writeFileSync(path.join(OUT_DIR, "survey-calls.csv"), "﻿" + callCsv.join("\n"), "utf-8");

    // ------------------------------------------------ 第3部 ログに載らない費用の手がかり（DB で数えられるもの）
    md.push(`## 第3部 AdvisorUsageLog 以外の手がかり（直近30日）`, "");
    const advAll = await prisma.advisorUsageLog.groupBy({ by: ["model"], where: { createdAt: { gte: since } }, _sum: { costUsd: true }, _count: { _all: true } });
    const advClaude = advAll.filter((r) => r.model.startsWith("claude")).reduce((s, r) => s + (r._sum.costUsd ?? 0), 0);
    const advOther = advAll.filter((r) => !r.model.startsWith("claude")).reduce((s, r) => s + (r._sum.costUsd ?? 0), 0);
    md.push(`- AdvisorUsageLog 合計 ${yen(advClaude + advOther)}（うち Anthropic ${yen(advClaude)} / Gemini 等 ${yen(advOther)}）`);
    const aiu = await prisma.aiUsageLog.groupBy({
      by: ["system", "endpoint", "model"],
      where: { createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, cachedInputTokens: true, estimatedCostJpy: true },
      _count: { _all: true },
    });
    const claudeRows = aiu.filter((r) => r.model.startsWith("claude"));
    md.push(`- AiUsageLog（別の記録表）のうち Anthropic モデルの行:`, "");
    md.push(`| system | endpoint | model | 回数 | 入力 | 出力 | 記録上の費用（円） |`);
    md.push(`|--|--|--|--:|--:|--:|--:|`);
    let aiuJpy = 0;
    for (const r of claudeRows.sort((a, b) => Number(b._sum.estimatedCostJpy ?? 0) - Number(a._sum.estimatedCostJpy ?? 0))) {
      const j = Number(r._sum.estimatedCostJpy ?? 0);
      aiuJpy += j;
      md.push(`| ${r.system} | ${r.endpoint} | ${r.model} | ${r._count._all} | ${(r._sum.inputTokens ?? 0).toLocaleString()} | ${(r._sum.outputTokens ?? 0).toLocaleString()} | ¥${Math.round(j).toLocaleString()} |`);
    }
    md.push(`| 計 | | | | | | ¥${Math.round(aiuJpy).toLocaleString()} |`, "");
    const [rpaMsgs, schedMsgs, expired] = await Promise.all([
      prisma.rpaErrorChatMessage.count({ where: { createdAt: { gte: since }, role: "assistant" } }),
      prisma.scheduleChat.groupBy({ by: ["chatType"], where: { createdAt: { gte: since }, role: "ASSISTANT" }, _count: { _all: true } }).catch(() => [] as { chatType: string; _count: { _all: number } }[]),
      prisma.recommendAnalyzeBatch.groupBy({ by: ["status"], where: { submittedAt: { gte: since } }, _count: { _all: true } }),
    ]);
    md.push(`- 記録なしの portal 内の呼び出し（応答の保存件数から回数だけ分かる）: RPAエラーチャットの AI 応答 ${rpaMsgs}件 / 日程チャット・振り返りの AI 応答 ${schedMsgs.map((s) => `${s.chatType} ${s._count._all}件`).join("・") || "0件"}`);
    md.push(`- 自動評価のまとめ送り台帳（投入30日）: ${expired.map((s) => `${s.status} ${s._count._all}`).join(" / ")}`, "");
    fs.writeFileSync(path.join(OUT_DIR, "survey-summary.md"), md.join("\n"), "utf-8");
    console.log(md.join("\n"));
  } finally {
    await prisma.$disconnect();
    await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export {};

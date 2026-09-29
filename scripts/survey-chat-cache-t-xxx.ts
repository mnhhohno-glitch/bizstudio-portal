/**
 * T-XXX step9 第1部 1-1 / 第2部: ポータルの Sonnet・Haiku 利用状況とキャッシュ（使い回し）の無駄の調査。
 *
 * 読み取りのみ（default_transaction_read_only=on で接続・起動時に SHOW で確認）。AI は一切呼ばない。
 *
 * 集計するもの（直近30日）:
 *   1. AdvisorUsageLog の endpoint × model 別の回数・トークン内訳（通常入力／キャッシュ書込／読込／出力）・費用
 *   2. AiUsageLog（T-135 帳簿）の Claude 分（file-parse の Haiku 画像OCR 等。AdvisorUsageLog に載らない呼び出し）
 *   3. AIアドバイザーのチャット（advisor-chat）のキャッシュの効き方
 *      - 直前の呼び出しからの間隔の分布（全体＝固定部 persona+skill の共有キャッシュ / 同じ求職者＝候補者情報ブロック）
 *      - 間隔ごとの書込・読込トークン
 *      - 1回だけで終わる会話（同じ求職者の呼び出しが前後30分以内に無い）の割合
 *      - 挨拶文（greeting）の回数と、その後に質問された割合
 *      - 直す案ごとの費用の見積もり（5分のまま／1時間／キャッシュの印を外す）。実績の書込・読込トークンから
 *        「固定部」と「候補者情報」の大きさを推定し、呼び出しの時刻列に当てはめて再計算する
 *   4. Haiku の機能別の回数・入力・出力・費用と、毎回同じ指示の大きさ（最小入力から推定）
 *   5. 時刻別の呼び出し数（決まった時刻に自動で動いているものの有無）
 *
 * 出力: 標準出力に Markdown（ID と集計値のみ・個人情報なし）。
 *       報告書 docs/reports/T-XXX_sonnet5-switch-and-cache-survey.md の第2部に転記する。
 *
 * 実行（master worktree）:
 *   npx tsx --env-file=.env scripts/survey-chat-cache-t-xxx.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c default_transaction_read_only=on",
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DAYS = 30;
const JPY_PER_USD = 157.42; // step1〜 と同じ
const TEST_CANDIDATE_ID = "cmmn4jipg00011dqt23w1q3bk"; // 大野テスト
const EPISODE_GAP_MS = 30 * 60_000; // 会話のまとまり（同じ求職者で30分以内に続く呼び出し）

// 公式料金 $/MTok。1時間書込は input×2
type Price = { input: number; output: number; write5m: number; read: number };
const PRICE: Record<string, Price> = {
  "claude-sonnet-4-6": { input: 3, output: 15, write5m: 3.75, read: 0.3 },
  "claude-sonnet-5": { input: 2, output: 10, write5m: 2.5, read: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, write5m: 1.25, read: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, write5m: 5, read: 0.2 },
  "claude-opus-4-6": { input: 5, output: 25, write5m: 6.25, read: 0.5 },
};

const yen = (usd: number) => `¥${Math.round(usd * JPY_PER_USD).toLocaleString()}`;
const man = (n: number) => `${(n / 10_000).toFixed(1)}万`;
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "-");
const jst = (d: Date) => new Date(d.getTime() + 9 * 3600_000);

type Log = {
  id: string;
  createdAt: Date;
  endpoint: string;
  candidateId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  note: string | null;
  isRetry: boolean;
};

function costParts(model: string, l: Pick<Log, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens">) {
  const p = PRICE[model];
  if (!p) return null;
  return {
    input: (l.inputTokens * p.input) / 1e6,
    write: (l.cacheCreationTokens * p.write5m) / 1e6,
    read: (l.cacheReadTokens * p.read) / 1e6,
    output: (l.outputTokens * p.output) / 1e6,
  };
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mode(a: number[]): { value: number; count: number } {
  const m = new Map<number, number>();
  for (const v of a) m.set(v, (m.get(v) ?? 0) + 1);
  let best = { value: 0, count: 0 };
  for (const [value, count] of m) if (count > best.count) best = { value, count };
  return best;
}

const GAP_BUCKETS: { label: string; maxMs: number }[] = [
  { label: "1分以内", maxMs: 60_000 },
  { label: "1〜5分", maxMs: 5 * 60_000 },
  { label: "5〜10分", maxMs: 10 * 60_000 },
  { label: "10〜30分", maxMs: 30 * 60_000 },
  { label: "30〜60分", maxMs: 60 * 60_000 },
  { label: "1時間超", maxMs: Infinity },
];
const bucketOf = (gapMs: number | null) =>
  gapMs == null ? "初回（前なし）" : GAP_BUCKETS.find((b) => gapMs <= b.maxMs)!.label;

async function main() {
  const ro = await pool.query("show default_transaction_read_only");
  if (ro.rows[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用で接続できていません");
  console.error("default_transaction_read_only=on");

  const until = new Date();
  const since = new Date(until.getTime() - DAYS * 86400_000);
  const md: string[] = [];
  md.push(`集計期間: ${jst(since).toISOString().slice(0, 16).replace("T", " ")} 〜 ${jst(until).toISOString().slice(0, 16).replace("T", " ")} JST（${DAYS}日）`, "");

  const logs: Log[] = await prisma.advisorUsageLog.findMany({
    where: { createdAt: { gte: since, lt: until } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, createdAt: true, endpoint: true, candidateId: true, model: true, inputTokens: true,
      outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true, costUsd: true, note: true, isRetry: true,
    },
  });

  // ---------------------------------------------------------------- 1. endpoint × model
  md.push("### 1. AdvisorUsageLog の機能 × モデル別（直近30日・大野テスト含む）", "");
  md.push("| 機能(endpoint) | モデル | 回数 | うち失敗 | 通常入力 | キャッシュ書込 | キャッシュ読込 | 出力 | 費用(記録値) | 内訳 入力/書込/読込/出力 |");
  md.push("|--|--|--:|--:|--:|--:|--:|--:|--:|--|");
  const groups = new Map<string, Log[]>();
  for (const l of logs) {
    const k = `${l.endpoint}\t${l.model}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  const totalsByModel = new Map<string, { n: number; input: number; write: number; read: number; output: number; cost: number }>();
  for (const [k, ls] of [...groups].sort((a, b) => b[1].reduce((s, l) => s + l.costUsd, 0) - a[1].reduce((s, l) => s + l.costUsd, 0))) {
    const [endpoint, model] = k.split("\t");
    const sum = (f: (l: Log) => number) => ls.reduce((s, l) => s + f(l), 0);
    const input = sum((l) => l.inputTokens), write = sum((l) => l.cacheCreationTokens), read = sum((l) => l.cacheReadTokens), output = sum((l) => l.outputTokens);
    const cost = sum((l) => l.costUsd);
    const fail = ls.filter((l) => (l.note ?? "").startsWith("error-")).length;
    const parts = costParts(model, { inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheCreationTokens: write });
    md.push(`| ${endpoint} | ${model} | ${ls.length} | ${fail} | ${man(input)} | ${man(write)} | ${man(read)} | ${man(output)} | ${yen(cost)} | ${parts ? `${yen(parts.input)} / ${yen(parts.write)} / ${yen(parts.read)} / ${yen(parts.output)}` : "-"} |`);
    const t = totalsByModel.get(model) ?? { n: 0, input: 0, write: 0, read: 0, output: 0, cost: 0 };
    t.n += ls.length; t.input += input; t.write += write; t.read += read; t.output += output; t.cost += cost;
    totalsByModel.set(model, t);
  }
  md.push("", "モデル別合計:", "");
  md.push("| モデル | 回数 | 入力合計（通常+書込+読込） | うち書込 | うち読込 | 出力 | 費用 |");
  md.push("|--|--:|--:|--:|--:|--:|--:|");
  for (const [model, t] of totalsByModel) {
    md.push(`| ${model} | ${t.n} | ${man(t.input + t.write + t.read)} | ${man(t.write)} | ${man(t.read)} | ${man(t.output)} | ${yen(t.cost)} |`);
  }
  md.push("");

  // Sonnet 5 に替えた場合の月額（同じ文章量なら新トークナイザで約1.3倍のトークン・単価は2/3）
  const sonnet = totalsByModel.get("claude-sonnet-4-6");
  if (sonnet) {
    const s5 = PRICE["claude-sonnet-5"];
    // トークン数の比（Sonnet 5 ÷ Sonnet 4.6）。公式の目安は1.3倍だが、日本語の読み比べ（compare-sonnet5-chat-t-xxx.ts）の
    // 実測は入力1.013倍・出力1.107倍（出力は応答が少し長くなった分を含む）
    const est = (inRatio: number, outRatio: number) =>
      ((sonnet.input * s5.input + sonnet.write * s5.write5m + sonnet.read * s5.read) * inRatio + sonnet.output * s5.output * outRatio) / 1e6;
    const measured = est(1.013, 1.107);
    const official = est(1.3, 1.3);
    md.push(`Sonnet 4.6 の記録値 ${yen(sonnet.cost)}/30日 → Sonnet 5 の単価で置き換えると、実測のトークン比（入力1.013倍・出力1.107倍）で ${yen(measured)}/30日（差 −${yen(sonnet.cost - measured)}）、公式目安の1.3倍なら ${yen(official)}/30日（差 −${yen(sonnet.cost - official)}）。`, "");
  }

  // ---------------------------------------------------------------- 2. AiUsageLog の Claude 分
  const aiRows = await prisma.$queryRawUnsafe<
    { endpoint: string; model: string; n: bigint; input: bigint | null; output: bigint | null; cached: bigint | null; jpy: string | null }[]
  >(
    `select endpoint, model, count(*) n, sum(input_tokens) input, sum(output_tokens) output, sum(cached_input_tokens) cached, sum(estimated_cost_jpy)::text jpy
       from ai_usage_logs where created_at >= $1 and created_at < $2 and system = 'portal' and model like 'claude%'
      group by endpoint, model order by count(*) desc`,
    since, until,
  );
  md.push("### 2. AiUsageLog（T-135 帳簿）の portal の Claude 分（AdvisorUsageLog に載らない呼び出し）", "");
  md.push("| endpoint | モデル | 回数 | 入力（書込含む） | 読込 | 出力 | 費用(帳簿・160円換算) |");
  md.push("|--|--|--:|--:|--:|--:|--:|");
  for (const r of aiRows) {
    md.push(`| ${r.endpoint} | ${r.model} | ${r.n} | ${man(Number(r.input ?? 0))} | ${man(Number(r.cached ?? 0))} | ${man(Number(r.output ?? 0))} | ¥${Math.round(Number(r.jpy ?? 0)).toLocaleString()} |`);
  }
  if (aiRows.length === 0) md.push("| （なし） | | | | | | |");
  md.push("");

  // ---------------------------------------------------------------- 3. advisor-chat のキャッシュ
  const chat = logs.filter((l) => l.endpoint === "advisor-chat" && !(l.note ?? "").startsWith("error-") && l.model === "claude-sonnet-4-6");
  md.push(`### 3. AIアドバイザーのチャット（advisor-chat・成功 ${chat.length} 回）`, "");

  // 固定部（persona+skill+タスク検出指示）の大きさ: 読込が固定部だけのとき＝候補者情報が書込になる呼び出しの読込値の最頻値
  const readsWithWrite = chat.filter((l) => l.cacheReadTokens > 0 && l.cacheCreationTokens > 0).map((l) => l.cacheReadTokens);
  const writesOnly = chat.filter((l) => l.cacheReadTokens === 0 && l.cacheCreationTokens > 0);
  const fixedMode = mode(readsWithWrite);
  const FIXED = fixedMode.value;
  md.push(`- 固定部（人物設定＋求人選定スキル＋タスク検出指示・全求職者で共通）の大きさ: **${FIXED.toLocaleString()} トークン**（「読込あり・書込あり」の呼び出し ${readsWithWrite.length} 回の読込値の最頻値・${fixedMode.count} 回一致）`);
  const ctxSizes = chat.map((l) => l.cacheCreationTokens + l.cacheReadTokens - FIXED).filter((v) => v > 0);
  md.push(`- 候補者情報ブロック（求職者ごと）の大きさ: 中央値 ${Math.round(median(ctxSizes)).toLocaleString()} トークン`);
  md.push(`- キャッシュに乗らない部分（会話履歴＋今回の質問）: 中央値 ${Math.round(median(chat.map((l) => l.inputTokens))).toLocaleString()} トークン（履歴には cache_control が無い）`);
  md.push(`- 出力: 中央値 ${Math.round(median(chat.map((l) => l.outputTokens))).toLocaleString()} トークン`);
  const kinds = { allWrite: 0, fixedReadCtxWrite: 0, allRead: 0, noCache: 0, other: 0 };
  for (const l of chat) {
    if (l.cacheReadTokens === 0 && l.cacheCreationTokens === 0) kinds.noCache++;
    else if (l.cacheReadTokens === 0) kinds.allWrite++;
    else if (l.cacheCreationTokens === 0) kinds.allRead++;
    else if (l.cacheReadTokens === FIXED) kinds.fixedReadCtxWrite++;
    else kinds.other++;
  }
  md.push(`- 呼び出しの内訳: 全部書込（固定部も候補者情報も切れていた） ${kinds.allWrite} 回（${pct(kinds.allWrite, chat.length)}）／固定部は読込・候補者情報は書込 ${kinds.fixedReadCtxWrite} 回（${pct(kinds.fixedReadCtxWrite, chat.length)}）／全部読込 ${kinds.allRead} 回（${pct(kinds.allRead, chat.length)}）／キャッシュなし ${kinds.noCache} 回／その他 ${kinds.other} 回`);
  md.push(`- 書込だけの呼び出しの書込量 中央値: ${Math.round(median(writesOnly.map((l) => l.cacheCreationTokens))).toLocaleString()} トークン`, "");

  // 間隔の分布
  const prevAny: (number | null)[] = [];
  const prevSame: (number | null)[] = [];
  const lastByCand = new Map<string, number>();
  let lastAny: number | null = null;
  for (const l of chat) {
    const t = l.createdAt.getTime();
    prevAny.push(lastAny == null ? null : t - lastAny);
    const key = l.candidateId ?? "(null)";
    const lc = lastByCand.get(key);
    prevSame.push(lc == null ? null : t - lc);
    lastAny = t;
    lastByCand.set(key, t);
  }
  const bucketTable = (title: string, gaps: (number | null)[]) => {
    md.push(`#### ${title}`, "");
    md.push("| 直前の呼び出しからの間隔 | 回数 | 割合 | 書込 | 読込 | 書込費用 | 読込費用 |");
    md.push("|--|--:|--:|--:|--:|--:|--:|");
    const labels = ["初回（前なし）", ...GAP_BUCKETS.map((b) => b.label)];
    for (const lab of labels) {
      const idx = gaps.map((g, i) => (bucketOf(g) === lab ? i : -1)).filter((i) => i >= 0);
      const w = idx.reduce((s, i) => s + chat[i].cacheCreationTokens, 0);
      const r = idx.reduce((s, i) => s + chat[i].cacheReadTokens, 0);
      md.push(`| ${lab} | ${idx.length} | ${pct(idx.length, chat.length)} | ${man(w)} | ${man(r)} | ${yen((w * 3.75) / 1e6)} | ${yen((r * 0.3) / 1e6)} |`);
    }
    md.push("");
  };
  bucketTable("3-1. 同じ求職者のチャットでの間隔（候補者情報ブロックのキャッシュが効くか）", prevSame);
  bucketTable("3-2. 全体での間隔（固定部は全求職者で共通のため、誰かのチャットが5分以内にあれば読込になる）", prevAny);

  // 会話のまとまり（同じ求職者で30分以内に続く呼び出し）
  const episodes: Log[][] = [];
  const openEp = new Map<string, Log[]>();
  for (const l of chat) {
    const key = l.candidateId ?? "(null)";
    const ep = openEp.get(key);
    if (ep && l.createdAt.getTime() - ep[ep.length - 1].createdAt.getTime() <= EPISODE_GAP_MS) ep.push(l);
    else {
      const n = [l];
      episodes.push(n);
      openEp.set(key, n);
    }
  }
  const single = episodes.filter((e) => e.length === 1);
  const epLen = episodes.map((e) => e.length);
  md.push("#### 3-3. 会話のまとまり（同じ求職者で30分以内に続く呼び出しを1つの会話とみなす）", "");
  md.push(`- 会話数 ${episodes.length}・1会話あたりの呼び出し 中央値 ${median(epLen)} 回・平均 ${(chat.length / Math.max(1, episodes.length)).toFixed(2)} 回`);
  md.push(`- **1回だけで終わる会話: ${single.length} 件（${pct(single.length, episodes.length)}）**。その書込費用 ${yen(single.reduce((s, l) => s + (l[0].cacheCreationTokens * 3.75) / 1e6, 0))}（書込しても次に読まれない分）`);
  const dist = new Map<number, number>();
  for (const n of epLen) dist.set(Math.min(n, 6), (dist.get(Math.min(n, 6)) ?? 0) + 1);
  md.push(`- 呼び出し回数の分布: ${[1, 2, 3, 4, 5, 6].map((n) => `${n === 6 ? "6回以上" : `${n}回`} ${dist.get(n) ?? 0}件`).join("・")}`);
  const distinctCand = new Set(chat.map((l) => l.candidateId)).size;
  md.push(`- 使った求職者 ${distinctCand} 人`, "");

  // 挨拶文
  const greet = logs.filter((l) => l.endpoint === "greeting" && !(l.note ?? "").startsWith("error-"));
  const greetFollowed = greet.filter((g) =>
    chat.some((c) => c.candidateId === g.candidateId && c.createdAt > g.createdAt && c.createdAt.getTime() - g.createdAt.getTime() <= 60 * 60_000),
  );
  const greetPreceded = greet.filter((g) =>
    chat.some((c) => c.candidateId === g.candidateId && c.createdAt < g.createdAt && g.createdAt.getTime() - c.createdAt.getTime() <= 60 * 60_000),
  );
  md.push("#### 3-4. 挨拶文（greeting）", "");
  md.push(`- 挨拶文の生成 ${greet.length} 回・費用 ${yen(greet.reduce((s, l) => s + l.costUsd, 0))}。キャッシュ書込 ${man(greet.reduce((s, l) => s + l.cacheCreationTokens, 0))}（挨拶文は cache_control を付けていない）`);
  md.push(`- 画面を開いただけでは作られない（コード確認: AdvisorFloatingPanel / AdvisorTab とも「挨拶文」ボタン押下の handleGenerateGreeting からのみ呼ぶ。パネルを開いたときの処理はセッションの取得・作成とメッセージ一覧の取得だけで AI を呼ばない）`);
  md.push(`- 挨拶文のあと1時間以内に同じ求職者でチャットの質問あり: ${greetFollowed.length}/${greet.length}（${pct(greetFollowed.length, greet.length)}）・挨拶文の前1時間以内に質問あり: ${greetPreceded.length}/${greet.length}`, "");

  // 3-5. 直す案ごとの再計算
  // 呼び出しの時刻列に TTL を当てはめ、固定部（全体で共有）と候補者情報（求職者ごと・大きさが同じなら同一内容とみなす）
  // が読込になるか書込になるかを決める。5分TTLで実績を再現できるかを先に確かめる（検算）。
  const simulate = (fixedTtl: number | null, ctxTtl: number | null) => {
    let usd = 0;
    let lastFixedWrite = -Infinity; // 最後に固定部を使った時刻（読込でも TTL は延びる）
    const lastCtx = new Map<string, { t: number; size: number }>();
    for (const l of chat) {
      const t = l.createdAt.getTime();
      const ctx = Math.max(0, l.cacheCreationTokens + l.cacheReadTokens - FIXED);
      const p = PRICE["claude-sonnet-4-6"];
      const writePrice = (ttl: number | null) => (ttl != null && ttl > 5 * 60_000 ? p.input * 2 : p.write5m);
      // 固定部
      if (fixedTtl == null) usd += (FIXED * p.input) / 1e6;
      else if (t - lastFixedWrite <= fixedTtl) usd += (FIXED * p.read) / 1e6;
      else usd += (FIXED * writePrice(fixedTtl)) / 1e6;
      lastFixedWrite = t;
      // 候補者情報
      const key = l.candidateId ?? "(null)";
      const prev = lastCtx.get(key);
      if (ctxTtl == null) usd += (ctx * p.input) / 1e6;
      else if (prev && prev.size === ctx && t - prev.t <= ctxTtl) usd += (ctx * p.read) / 1e6;
      else usd += (ctx * writePrice(ctxTtl)) / 1e6;
      lastCtx.set(key, { t, size: ctx });
      // 履歴・質問・出力は案によらず同じ
      usd += (l.inputTokens * p.input + l.outputTokens * p.output) / 1e6;
    }
    return usd;
  };
  const actual = chat.reduce((s, l) => s + l.costUsd, 0);
  const actualParts = chat.reduce(
    (s, l) => {
      const c = costParts("claude-sonnet-4-6", l)!;
      return { input: s.input + c.input, write: s.write + c.write, read: s.read + c.read, output: s.output + c.output };
    },
    { input: 0, write: 0, read: 0, output: 0 },
  );
  const M5 = 5 * 60_000, H1 = 60 * 60_000;
  const base = simulate(M5, M5);
  const scenarios: [string, number][] = [
    ["今のまま（5分・検算）", base],
    ["固定部・候補者情報とも1時間", simulate(H1, H1)],
    ["固定部だけ1時間・候補者情報は5分", simulate(H1, M5)],
    ["候補者情報の印を外す（固定部は5分のまま）", simulate(M5, null)],
    ["キャッシュの印を全部外す", simulate(null, null)],
  ];
  md.push("#### 3-5. 直す案ごとの再計算（advisor-chat・Sonnet 4.6 単価・30日）", "");
  md.push(`実績（記録値）: ${yen(actual)}（通常入力 ${yen(actualParts.input)}・書込 ${yen(actualParts.write)}・読込 ${yen(actualParts.read)}・出力 ${yen(actualParts.output)}）`, "");
  md.push("| 案 | 30日の費用 | 今のまま（検算値）との差 |");
  md.push("|--|--:|--:|");
  for (const [name, v] of scenarios) md.push(`| ${name} | ${yen(v)} | ${v === base ? "-" : `${v < base ? "−" : "+"}${yen(Math.abs(v - base))}`} |`);
  md.push("", `検算: 5分TTLの再計算 ${yen(base)} ÷ 実績 ${yen(actual)} = ${(base / actual).toFixed(3)}（1に近いほど推定が実績を再現できている）`, "");

  // 3-6. 日報アシスト（daily-report-assist）: system は「日報skill＋求人選定skill」1ブロックに cache_control（全員で共通）。
  // 会話履歴には印が無い。固定ブロックの大きさ＝書込だけの呼び出しの書込値の最頻値。
  const dra = logs.filter((l) => l.endpoint === "daily-report-assist" && l.model === "claude-sonnet-4-6" && !(l.note ?? "").startsWith("error-"));
  if (dra.length > 0) {
    const draFixed = mode(dra.filter((l) => l.cacheCreationTokens > 0).map((l) => l.cacheCreationTokens)).value;
    const p = PRICE["claude-sonnet-4-6"];
    const simFixed = (ttl: number | null) => {
      let usd = 0;
      let last = -Infinity;
      for (const l of dra) {
        const t = l.createdAt.getTime();
        if (ttl == null) usd += (draFixed * p.input) / 1e6;
        else if (t - last <= ttl) usd += (draFixed * p.read) / 1e6;
        else usd += (draFixed * (ttl > 5 * 60_000 ? p.input * 2 : p.write5m)) / 1e6;
        last = t;
        usd += (l.inputTokens * p.input + l.outputTokens * p.output) / 1e6;
      }
      return usd;
    };
    const gaps = dra.slice(1).map((l, i) => l.createdAt.getTime() - dra[i].createdAt.getTime());
    const within5 = gaps.filter((g) => g <= 5 * 60_000).length;
    const within60 = gaps.filter((g) => g <= 60 * 60_000).length;
    const b5 = simFixed(5 * 60_000);
    md.push("#### 3-6. 日報アシスト（daily-report-assist・Sonnet 4.6 単価・30日）", "");
    md.push(`- 回数 ${dra.length}・固定ブロック（日報skill＋求人選定skill）の大きさ ${draFixed.toLocaleString()} トークン・実績 ${yen(dra.reduce((s, l) => s + l.costUsd, 0))}`);
    md.push(`- 直前の日報アシスト（誰のものでも）からの間隔: 5分以内 ${within5}/${gaps.length}（${pct(within5, gaps.length)}）・60分以内 ${within60}/${gaps.length}（${pct(within60, gaps.length)}）`);
    md.push(`- 今のまま（5分・検算）${yen(b5)}／1時間 ${yen(simFixed(60 * 60_000))}（差 ${yen(simFixed(60 * 60_000) - b5)}）／印を外す ${yen(simFixed(null))}（差 ${yen(simFixed(null) - b5)}）`, "");
  }

  // ---------------------------------------------------------------- 4. Haiku
  const haiku = logs.filter((l) => l.model === "claude-haiku-4-5");
  md.push("### 4. Haiku 4.5（AdvisorUsageLog 分）", "");
  md.push("| 機能 | 回数 | 1回の入力（通常+書込+読込）最小 / 中央値 | 書込合計 | 読込合計 | 出力合計 | 費用 | 使った日数 |");
  md.push("|--|--:|--|--:|--:|--:|--:|--:|");
  const hg = new Map<string, Log[]>();
  for (const l of haiku) {
    if (!hg.has(l.endpoint)) hg.set(l.endpoint, []);
    hg.get(l.endpoint)!.push(l);
  }
  for (const [ep, ls] of hg) {
    const tot = ls.map((l) => l.inputTokens + l.cacheCreationTokens + l.cacheReadTokens);
    const days = new Set(ls.map((l) => jst(l.createdAt).toISOString().slice(0, 10))).size;
    md.push(`| ${ep} | ${ls.length} | ${Math.min(...tot).toLocaleString()} / ${Math.round(median(tot)).toLocaleString()} | ${man(ls.reduce((s, l) => s + l.cacheCreationTokens, 0))} | ${man(ls.reduce((s, l) => s + l.cacheReadTokens, 0))} | ${man(ls.reduce((s, l) => s + l.outputTokens, 0))} | ${yen(ls.reduce((s, l) => s + l.costUsd, 0))} | ${days} |`);
  }
  md.push("", "（Haiku 4.5 の最小キャッシュ長は 4,096 トークン。1回の入力の最小値がこれを下回る機能は、cache_control を付けていても書込・読込が発生しない）", "");

  // ---------------------------------------------------------------- 5. 時刻別
  md.push("### 5. 時刻別の呼び出し数（JST・Sonnet と Haiku・30日合計）", "");
  const hours = (ls: Log[]) => {
    const h = new Array(24).fill(0);
    for (const l of ls) h[jst(l.createdAt).getUTCHours()]++;
    return h;
  };
  const endpointsForHour = [...new Set(logs.filter((l) => l.model.includes("sonnet") || l.model.includes("haiku")).map((l) => l.endpoint))];
  md.push(`| 機能 | ${Array.from({ length: 24 }, (_, i) => i).join(" | ")} |`);
  md.push(`|--|${Array.from({ length: 24 }, () => "--:").join("|")}|`);
  for (const ep of endpointsForHour) {
    md.push(`| ${ep} | ${hours(logs.filter((l) => l.endpoint === ep && (l.model.includes("sonnet") || l.model.includes("haiku")))).join(" | ")} |`);
  }
  md.push("");

  // ---------------------------------------------------------------- 6. 大野テスト分（参考）
  const testLogs = logs.filter((l) => l.candidateId === TEST_CANDIDATE_ID);
  md.push(`（参考）上記のうち大野テストの呼び出し: ${testLogs.length} 回・${yen(testLogs.reduce((s, l) => s + l.costUsd, 0))}`, "");

  console.log(md.join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

export {};

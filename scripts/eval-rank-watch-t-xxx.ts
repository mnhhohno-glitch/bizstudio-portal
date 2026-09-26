/**
 * T-XXX: 求人評価モデル切り替え（Opus 4.6 → Opus 5.5）後の見張り用スクリプト。読み取りのみ・AI は呼ばない。
 *
 * 日別・経路別（手動＝analyze-batch／自動配信＝recommend-analyze）・モデル別に次を出す:
 *   - 評価件数（AI に送った求人数）・1件あたり費用
 *   - 総合ランクの分布（A/B+/B/C/D）・通過率ランクの分布（A/B/C/D）
 *   - 自動配信で評価 D として自動で外れた件数
 *   - 変更なしスキップ（前回の結果を使用）の件数 ※評価履歴（job_eval_records）がある期間のみ
 *
 * 2つの材料を使う:
 *   [A] AdvisorUsageLog + CandidateFile … 切り替え前（Opus 4.6）の基準値もこれで出せる。
 *       CandidateFile は最新の評価しか持たないため、ランク分布は「その期間に評価されて今も残っている行」。
 *       評価件数は AdvisorUsageLog.fileCount の合計（やり直しも含む実数）。
 *   [B] JobEvalRecord（T-XXX で新設）… 評価1回×求人1件の履歴。SAVED/REUSED/SKIPPED/FAILED を区別できる。
 *
 * 実行:
 *   npx tsx --env-file=.env scripts/eval-rank-watch-t-xxx.ts                 # 直近30日
 *   npx tsx --env-file=.env scripts/eval-rank-watch-t-xxx.ts --days 14
 *   npx tsx --env-file=.env scripts/eval-rank-watch-t-xxx.ts --from 2026-09-25 --to 2026-10-08   # JST の暦日
 *   （portal-2 から実行する場合は DATABASE_URL を export してから。切り替え前後の比較は --from/--to で期間を分けて2回実行する）
 *
 * 罠#17（JST）: 日付は toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})。toISOString().slice(0,10) は使わない。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const JPY_PER_USD = 157.42; // step1〜4 と同じ為替
const AUTO_REJECT_REASON_D = "AI評価D（自動）"; // src/lib/recommend/auto-approval-shared.ts と同値
const RATING_VALUE = "B\\+|A|B|C|D";
const OVERALL_RANKS = ["A", "B+", "B", "C", "D"] as const;
const PASS_RANKS = ["A", "B", "C", "D"] as const;

function jstDate(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
/** JST 暦日の 00:00 を UTC instant にする。 */
function jstStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}
function headRating(v: string | null | undefined): string {
  const m = (v ?? "").match(new RegExp(`^(${RATING_VALUE})`));
  return m ? m[1] : "-";
}
function passRating(comment: string | null | undefined): string {
  const m = (comment ?? "").match(new RegExp(`(?:■\\s*)?通過率[：:]\\s*(${RATING_VALUE})`));
  return m ? m[1] : "-";
}
function dist(values: string[], ranks: readonly string[]): string {
  const c: Record<string, number> = {};
  for (const v of values) c[v] = (c[v] ?? 0) + 1;
  const n = values.length;
  return ranks
    .map((r) => `${r}:${c[r] ?? 0}${n > 0 ? `(${Math.round(((c[r] ?? 0) / n) * 100)}%)` : ""}`)
    .concat(c["-"] ? [`不明:${c["-"]}`] : [])
    .join(" ");
}
function yen(usd: number): string {
  return `¥${(usd * JPY_PER_USD).toFixed(1)}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const days = Number(get("--days") ?? 30);
  const to = get("--to");
  const from = get("--from");
  const todayJst = jstDate(new Date());
  const toYmd = to ?? todayJst;
  const fromYmd = from ?? jstDate(new Date(jstStart(toYmd).getTime() - (days - 1) * 86400000));
  return { fromYmd, toYmd, since: jstStart(fromYmd), until: new Date(jstStart(toYmd).getTime() + 86400000) };
}

type Key = string; // `${date}|${route}|${model}`
function key(date: string, route: string, model: string): Key {
  return `${date}|${route}|${model}`;
}

async function sectionA(since: Date, until: Date) {
  console.log("\n## [A] AdvisorUsageLog + CandidateFile（切り替え前の基準値もこれ）\n");
  const logs = await prisma.advisorUsageLog.findMany({
    where: { createdAt: { gte: since, lt: until }, endpoint: { in: ["analyze-batch", "recommend-analyze"] } },
    select: { createdAt: true, endpoint: true, model: true, fileCount: true, costUsd: true, note: true, inputTokens: true, outputTokens: true },
  });
  const files = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", aiAnalyzedAt: { gte: since, lt: until } },
    select: { aiAnalyzedAt: true, aiMatchRating: true, aiAnalysisComment: true, autoSourcedAt: true, rejectedReason: true },
  });

  type Agg = { calls: number; files: number; cost: number; failed: number; maxTok: number; overall: string[]; pass: string[]; autoD: number };
  const byKey = new Map<Key, Agg>();
  const get = (k: Key) => {
    let a = byKey.get(k);
    if (!a) {
      a = { calls: 0, files: 0, cost: 0, failed: 0, maxTok: 0, overall: [], pass: [], autoD: 0 };
      byKey.set(k, a);
    }
    return a;
  };
  for (const l of logs) {
    const route = l.endpoint === "recommend-analyze" ? "自動配信" : "手動";
    const a = get(key(jstDate(l.createdAt), route, l.model));
    a.calls++;
    if (l.note?.startsWith("error-")) a.failed++;
    else a.files += l.fileCount ?? 0;
    a.cost += l.costUsd;
    if (l.note?.includes("stop-max_tokens")) a.maxTok++;
  }
  // ランク分布は CandidateFile（モデル列が無いので、その日の同経路のログのモデルに寄せる。複数あれば "mixed"）
  const modelByDateRoute = new Map<string, Set<string>>();
  for (const k of byKey.keys()) {
    const [d, r, m] = k.split("|");
    const s = modelByDateRoute.get(`${d}|${r}`) ?? new Set<string>();
    s.add(m);
    modelByDateRoute.set(`${d}|${r}`, s);
  }
  for (const f of files) {
    const d = jstDate(f.aiAnalyzedAt!);
    const route = f.autoSourcedAt ? "自動配信" : "手動";
    const models = [...(modelByDateRoute.get(`${d}|${route}`) ?? [])];
    const model = models.length === 1 ? models[0] : models.length === 0 ? "(ログなし)" : "mixed";
    const a = get(key(d, route, model));
    a.overall.push(headRating(f.aiMatchRating));
    a.pass.push(passRating(f.aiAnalysisComment));
    if (f.autoSourcedAt && f.rejectedReason === AUTO_REJECT_REASON_D) a.autoD++;
  }

  console.log("| 日付(JST) | 経路 | モデル | 呼出 | 評価件数 | 費用 | 1件あたり | 総合(残存行) | 通過率(残存行) | D自動除外 | 途切れ | 失敗 |");
  console.log("|--|--|--|--:|--:|--:|--:|--|--|--:|--:|--:|");
  const keys = [...byKey.keys()].sort();
  for (const k of keys) {
    const [d, r, m] = k.split("|");
    const a = byKey.get(k)!;
    console.log(
      `| ${d} | ${r} | ${m} | ${a.calls} | ${a.files} | ${yen(a.cost)} | ${a.files > 0 ? yen(a.cost / a.files) : "-"} | ${dist(a.overall, OVERALL_RANKS)} | ${dist(a.pass, PASS_RANKS)} | ${a.autoD} | ${a.maxTok} | ${a.failed} |`,
    );
  }

  // モデル×経路の合計
  console.log("\n### 期間合計（経路 × モデル）\n");
  console.log("| 経路 | モデル | 呼出 | 評価件数 | 費用 | 1件あたり | 総合(残存行 n) | 通過率(残存行) | D自動除外 | 途切れ | 失敗 |");
  console.log("|--|--|--:|--:|--:|--:|--|--|--:|--:|--:|");
  const tot = new Map<string, Agg>();
  for (const k of keys) {
    const [, r, m] = k.split("|");
    const a = byKey.get(k)!;
    const tk = `${r}|${m}`;
    let t = tot.get(tk);
    if (!t) {
      t = { calls: 0, files: 0, cost: 0, failed: 0, maxTok: 0, overall: [], pass: [], autoD: 0 };
      tot.set(tk, t);
    }
    t.calls += a.calls; t.files += a.files; t.cost += a.cost; t.failed += a.failed; t.maxTok += a.maxTok; t.autoD += a.autoD;
    t.overall.push(...a.overall); t.pass.push(...a.pass);
  }
  for (const [tk, t] of [...tot].sort()) {
    const [r, m] = tk.split("|");
    console.log(
      `| ${r} | ${m} | ${t.calls} | ${t.files} | ${yen(t.cost)} | ${t.files > 0 ? yen(t.cost / t.files) : "-"} | n=${t.overall.length} ${dist(t.overall, OVERALL_RANKS)} | ${dist(t.pass, PASS_RANKS)} | ${t.autoD} | ${t.maxTok} | ${t.failed} |`,
    );
  }
}

async function sectionB(since: Date, until: Date) {
  console.log("\n## [B] JobEvalRecord（評価履歴・T-XXX 以降）\n");
  let recs: { createdAt: Date; route: string; status: string; model: string; effort: string | null; overallRating: string | null; passRating: string | null; costUsd: number | null; candidateFileId: string }[];
  try {
    recs = await prisma.jobEvalRecord.findMany({
      where: { createdAt: { gte: since, lt: until } },
      select: { createdAt: true, route: true, status: true, model: true, effort: true, overallRating: true, passRating: true, costUsd: true, candidateFileId: true },
    });
  } catch (e) {
    console.log("（job_eval_records を読めません。マイグレーション前の DB か、接続先を確認してください）", e instanceof Error ? e.message.split("\n")[0] : e);
    return;
  }
  if (recs.length === 0) {
    console.log("（この期間の履歴行はありません）");
    return;
  }
  // 自動配信で D → 自動除外された行（CandidateFile 側の rejectedReason で確認）
  const autoDIds = new Set(
    (
      await prisma.candidateFile.findMany({
        where: { id: { in: [...new Set(recs.filter((r) => r.route === "auto" && r.overallRating === "D").map((r) => r.candidateFileId))] }, rejectedReason: AUTO_REJECT_REASON_D },
        select: { id: true },
      })
    ).map((f) => f.id),
  );
  type Agg = { saved: number; reused: number; skipped: number; failed: number; pending: number; cost: number; overall: string[]; pass: string[]; autoD: number };
  const byKey = new Map<Key, Agg>();
  const get = (k: Key) => {
    let a = byKey.get(k);
    if (!a) {
      a = { saved: 0, reused: 0, skipped: 0, failed: 0, pending: 0, cost: 0, overall: [], pass: [], autoD: 0 };
      byKey.set(k, a);
    }
    return a;
  };
  const routeLabel: Record<string, string> = { full: "手動:全件", incremental: "手動:追加", "invalid-only": "手動:未評価/破損", auto: "自動配信" };
  for (const r of recs) {
    const a = get(key(jstDate(r.createdAt), routeLabel[r.route] ?? r.route, `${r.model}${r.effort ? `/${r.effort}` : ""}`));
    if (r.status === "SAVED") {
      a.saved++;
      a.cost += r.costUsd ?? 0;
      a.overall.push(r.overallRating ?? "-");
      a.pass.push(r.passRating ?? "-");
      if (r.route === "auto" && r.overallRating === "D" && autoDIds.has(r.candidateFileId)) a.autoD++;
    } else if (r.status === "REUSED") a.reused++;
    else if (r.status === "SKIPPED") { a.skipped++; a.cost += r.costUsd ?? 0; }
    else if (r.status === "FAILED") a.failed++;
    else if (r.status === "PENDING") a.pending++;
  }
  console.log("| 日付(JST) | 経路 | モデル/effort | 評価(SAVED) | スキップ(前回使用) | 不揃い | 失敗 | 未回収 | 費用 | 1件あたり | 総合 | 通過率 | D自動除外 |");
  console.log("|--|--|--|--:|--:|--:|--:|--:|--:|--:|--|--|--:|");
  for (const k of [...byKey.keys()].sort()) {
    const [d, r, m] = k.split("|");
    const a = byKey.get(k)!;
    const sent = a.saved + a.skipped;
    console.log(
      `| ${d} | ${r} | ${m} | ${a.saved} | ${a.reused} | ${a.skipped} | ${a.failed} | ${a.pending} | ${yen(a.cost)} | ${sent > 0 ? yen(a.cost / sent) : "-"} | ${dist(a.overall, OVERALL_RANKS)} | ${dist(a.pass, PASS_RANKS)} | ${a.autoD} |`,
    );
  }
}

async function main() {
  const { fromYmd, toYmd, since, until } = parseArgs();
  console.log(`# 求人評価の見張り（${fromYmd} 〜 ${toYmd} JST・為替 ${JPY_PER_USD}円/USD）`);
  await sectionA(since, until);
  await sectionB(since, until);
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

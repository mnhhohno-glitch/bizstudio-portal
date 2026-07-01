/**
 * T-126 Phase1: AIアドバイザー API usage 集計レポート（AdvisorUsageLog）。
 *
 * AdvisorUsageLog に蓄積された usage を、日次別 / endpoint 別 / candidateId 別に集計し、
 * コール数・トークン内訳・costUsd 合計・isRetry 件数を出力する。読み取りのみ・書き込みなし。
 *
 * 実行:
 *   npx tsx scripts/advisor-usage-report.ts                # 直近7日
 *   npx tsx scripts/advisor-usage-report.ts --days 30      # 直近30日
 *   npx tsx scripts/advisor-usage-report.ts --days 1 --by-candidate   # candidateId別も出す
 *
 * 罠#17（JST）: Railway/DB は UTC。日次は toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})
 *   で JST 日付を出す。toISOString().slice(0,10) / getDay() は使わない。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** JST の YYYY-MM-DD（罠#17）。 */
function jstDate(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

type Row = {
  createdAt: Date;
  endpoint: string;
  candidateId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  isRetry: boolean;
};

type Agg = {
  calls: number;
  retries: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  cost: number;
};

function emptyAgg(): Agg {
  return { calls: 0, retries: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 };
}

function add(a: Agg, r: Row): void {
  a.calls += 1;
  if (r.isRetry) a.retries += 1;
  a.input += r.inputTokens;
  a.output += r.outputTokens;
  a.cacheRead += r.cacheReadTokens;
  a.cacheCreate += r.cacheCreationTokens;
  a.cost += r.costUsd;
}

function printTable(title: string, entries: [string, Agg][]): void {
  console.log(`\n=== ${title} ===`);
  console.log(
    [
      "key".padEnd(28),
      "calls".padStart(6),
      "retry".padStart(6),
      "input".padStart(10),
      "output".padStart(9),
      "cRead".padStart(10),
      "cCreate".padStart(10),
      "cost".padStart(10),
    ].join(" ")
  );
  for (const [key, a] of entries) {
    console.log(
      [
        key.padEnd(28),
        String(a.calls).padStart(6),
        String(a.retries).padStart(6),
        String(a.input).padStart(10),
        String(a.output).padStart(9),
        String(a.cacheRead).padStart(10),
        String(a.cacheCreate).padStart(10),
        usd(a.cost).padStart(10),
      ].join(" ")
    );
  }
}

async function main() {
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 7;
  const byCandidate = process.argv.includes("--by-candidate");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = (await prisma.advisorUsageLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      endpoint: true,
      candidateId: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
      costUsd: true,
      isRetry: true,
    },
  })) as Row[];

  console.log(`AdvisorUsageLog 集計: 直近 ${days} 日（${jstDate(since)} JST 〜）`);
  console.log(`総レコード数: ${rows.length}`);

  if (rows.length === 0) {
    console.log("（データなし）");
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // 全体
  const total = emptyAgg();
  for (const r of rows) add(total, r);
  printTable("全体", [["ALL", total]]);

  // 1コール単価（median / avg）
  const costs = rows.map((r) => r.costUsd).sort((a, b) => a - b);
  const median = costs.length % 2 === 0 ? (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2 : costs[Math.floor(costs.length / 2)];
  console.log(`\n1コール単価: median ${usd(median)} / avg ${usd(total.cost / rows.length)} / min ${usd(costs[0])} / max ${usd(costs[costs.length - 1])}`);

  // endpoint 別
  const byEp = new Map<string, Agg>();
  for (const r of rows) {
    if (!byEp.has(r.endpoint)) byEp.set(r.endpoint, emptyAgg());
    add(byEp.get(r.endpoint)!, r);
  }
  printTable("endpoint別", [...byEp.entries()].sort((a, b) => b[1].cost - a[1].cost));

  // model 別
  const byModel = new Map<string, Agg>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, emptyAgg());
    add(byModel.get(r.model)!, r);
  }
  printTable("model別", [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost));

  // 日次別（JST）
  const byDay = new Map<string, Agg>();
  for (const r of rows) {
    const d = jstDate(r.createdAt);
    if (!byDay.has(d)) byDay.set(d, emptyAgg());
    add(byDay.get(d)!, r);
  }
  printTable("日次別(JST)", [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  // candidateId 別（--by-candidate 指定時のみ・上位20）
  if (byCandidate) {
    const byCand = new Map<string, Agg>();
    for (const r of rows) {
      const key = r.candidateId ?? "(none)";
      if (!byCand.has(key)) byCand.set(key, emptyAgg());
      add(byCand.get(key)!, r);
    }
    printTable(
      "candidateId別（コスト上位20）",
      [...byCand.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 20)
    );
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

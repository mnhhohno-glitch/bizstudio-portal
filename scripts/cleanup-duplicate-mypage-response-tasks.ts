/**
 * 【マイページ回答】タスクの重複掃除
 *
 * 背景: 旧 createOrUpdateResponseTask は 10分dedup 窓を超えると新規タスクを作り続け、
 *   さらに findFirst→create のレースで同時刻の二重作成も起きていた（例: 鵜沢萌未さん）。
 *   集約化（未着手タスク1枚へ上書き）を入れた後も、過去に積み上がった重複は残るため掃除する。
 *
 * 対象: 求職者ごとに status=NOT_STARTED の【マイページ回答】タスクが2枚以上あるケース。
 *   最新（createdAt desc）の1枚を残し、それ以外を COMPLETED に変更する（物理削除しない）。
 *
 * 残す1枚の本文は、現在の CandidateJobResponse 全量（＝新ロジックと同じ内容）へ更新する。
 *   求人名は kyuujinPDF から解決し、1件も解決できなければ本文を温存する（新ロジックと同一ガード）。
 *
 * 安全策:
 *   - dry-run（既定）は一切書き込まない。--execute 指定時のみ変更。
 *   - COMPLETED 化のみで DELETE はしない（誤爆時は status を戻せば復旧できる）。
 *   - rollback CSV を verify/ に出力（対象タスクIDと変更前 status）。
 *   - idempotent: 2回目以降は対象0件で正常終了する。
 *
 * ★求人名の解決には KYUUJIN_PDF_TOOL_URL が必要。未設定だとラベルが1件も引けず、本文更新は
 *   全件「温存」になる（既存本文を「求人ID: 12345」で潰さないためのガード。データは壊れない）。
 *   本番の値は Railway の bizstudio-portal サービスの環境変数を参照。
 *
 * --refresh-all: 重複の有無に関わらず、未着手の【マイページ回答】タスク全件の本文を全量へ更新する。
 *   重複掃除を先に済ませた後（＝2回目以降は重複0件で keep 対象も0件になる）に、既存タスクの本文を
 *   新ロジックの全量表示へ揃えるために使う。
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-mypage-response-tasks.ts            # dry-run
 *   npx tsx scripts/cleanup-duplicate-mypage-response-tasks.ts --execute  # 実行
 *   npx tsx scripts/cleanup-duplicate-mypage-response-tasks.ts --refresh-all --execute
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "fs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");
// 重複が無いタスクも含め、未着手の【マイページ回答】タスク全件の本文を全量へ更新する。
const REFRESH_ALL = process.argv.includes("--refresh-all");
const TITLE_PREFIX = "【マイページ回答】";

type KyuujinJobLite = { company: string; title: string };

// src/lib/mypage-response-sync.ts の fetchCandidateJobsMap と同一（スクリプトからは import できないため写し）。
async function fetchJobMap(candidateNumber: string | null): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!candidateNumber) return map;
  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL;
  if (!baseUrl) return map;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `${baseUrl}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
      { signal: controller.signal }
    ).finally(() => clearTimeout(timeout));
    if (!res.ok) return map;
    const data = await res.json();
    if (data.jobs && Array.isArray(data.jobs)) {
      for (const job of data.jobs as { id: number; company_name?: string; job_title?: string }[]) {
        const v: KyuujinJobLite = {
          company: (job.company_name ?? "").replace(/_\d{14,}$/, ""),
          title: job.job_title ?? "",
        };
        map.set(job.id, [v.company, v.title].filter(Boolean).join(" "));
      }
    }
  } catch {
    // 応答不能時は空 Map（呼び出し側で本文温存）
  }
  return map;
}

// src/lib/mypage-response-sync.ts の buildTaskContent と同一の出力。
function buildTaskContent(
  candidateName: string,
  responses: { externalJobId: number; response: string }[],
  jobMap: Map<number, string>
): { title: string; description: string } {
  if (responses.length === 0) {
    return {
      title: `${TITLE_PREFIX}${candidateName} - 回答なし`,
      description: [
        `${candidateName}様のマイページ回答状況（最新の全量）です。`,
        "",
        "（現在有効な回答はありません。すべて取り下げ・保留等に変更されました）",
      ].join("\n"),
    };
  }
  const grouped: Record<string, string[]> = {};
  for (const r of responses) {
    if (!grouped[r.response]) grouped[r.response] = [];
    grouped[r.response].push(jobMap.get(r.externalJobId) ?? `求人ID: ${r.externalJobId}`);
  }
  const titleParts: string[] = [];
  if (grouped.WANT_TO_APPLY) titleParts.push(`応募したい（${grouped.WANT_TO_APPLY.length}件）`);
  if (grouped.INTERESTED) titleParts.push(`気になる（${grouped.INTERESTED.length}件）`);
  const title = `${TITLE_PREFIX}${candidateName} - ${titleParts.join("・")}`;

  const lines = [`${candidateName}様のマイページ回答状況（最新の全量）です。`, ""];
  for (const key of ["WANT_TO_APPLY", "INTERESTED"] as const) {
    if (!grouped[key]) continue;
    lines.push(`▶ ${key === "WANT_TO_APPLY" ? "応募したい" : "気になる"}（${grouped[key].length}件）`);
    for (const label of grouped[key]) lines.push(`・${label}`);
    lines.push("");
  }
  return { title, description: lines.join("\n") };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log(`[cleanup-dup-tasks] Mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

  const tasks = await prisma.task.findMany({
    where: { status: "NOT_STARTED", title: { startsWith: TITLE_PREFIX } },
    select: {
      id: true,
      title: true,
      candidateId: true,
      createdAt: true,
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`[cleanup-dup-tasks] 未着手の【マイページ回答】タスク: ${tasks.length} 件`);

  // 求職者ごとにグルーピング（candidateId が null のタスクは対象外＝求職者を特定できない）
  const byCandidate = new Map<string, typeof tasks>();
  let orphan = 0;
  for (const t of tasks) {
    if (!t.candidateId) {
      orphan++;
      continue;
    }
    const arr = byCandidate.get(t.candidateId) ?? [];
    arr.push(t);
    byCandidate.set(t.candidateId, arr);
  }

  const dupCandidates = [...byCandidate.entries()].filter(([, v]) => v.length >= 2);
  const closeTargets: {
    taskId: string;
    candidateId: string;
    candidateName: string;
    candidateNumber: string;
    title: string;
    createdAt: string;
  }[] = [];
  const keepTargets: { taskId: string; candidateId: string; candidateNumber: string; candidateName: string }[] = [];

  // --refresh-all のときは重複していない求職者も本文更新の対象に含める。
  const refreshSource = REFRESH_ALL ? [...byCandidate.entries()] : dupCandidates;
  for (const [candidateId, list] of refreshSource) {
    const keep = list[0]; // findMany は createdAt desc なので先頭が最新
    keepTargets.push({
      taskId: keep.id,
      candidateId,
      candidateNumber: keep.candidate?.candidateNumber ?? "",
      candidateName: keep.candidate?.name ?? "",
    });
  }

  for (const [candidateId, list] of dupCandidates) {
    const [, ...rest] = list;
    for (const r of rest) {
      closeTargets.push({
        taskId: r.id,
        candidateId,
        candidateName: r.candidate?.name ?? "",
        candidateNumber: r.candidate?.candidateNumber ?? "",
        title: r.title,
        createdAt: r.createdAt.toISOString(),
      });
    }
  }

  console.log("");
  console.log("=== 結果 ===");
  console.log(`  重複している求職者          : ${dupCandidates.length} 名`);
  console.log(`  COMPLETED 化する重複タスク  : ${closeTargets.length} 件`);
  console.log(
    `  本文を全量更新する枚数      : ${keepTargets.length} 件${REFRESH_ALL ? "（--refresh-all: 重複なしも含む）" : "（重複を解消して残す1枚）"}`
  );
  if (!process.env.KYUUJIN_PDF_TOOL_URL) {
    console.warn(
      "  ⚠ KYUUJIN_PDF_TOOL_URL 未設定: 求人名を解決できないため本文更新は全件「温存」になります"
    );
  }
  if (orphan > 0) console.log(`  candidateId なし（対象外）  : ${orphan} 件`);

  // 重複枚数の分布
  const dist: Record<number, number> = {};
  for (const [, v] of dupCandidates) dist[v.length] = (dist[v.length] || 0) + 1;
  console.log(`  枚数分布（枚数:人数）      : ${JSON.stringify(dist)}`);

  // 上位サンプル
  const sample = [...dupCandidates]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  if (sample.length > 0) {
    console.log("  --- 上位サンプル ---");
    for (const [, v] of sample) {
      console.log(
        `   ${v[0].candidate?.name ?? "?"}（${v[0].candidate?.candidateNumber ?? "?"}）: ${v.length} 枚`
      );
    }
  }

  // rollback CSV
  if (closeTargets.length > 0) {
    try {
      mkdirSync("verify", { recursive: true });
    } catch {
      /* 既存なら無視 */
    }
    const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    const csvPath = `verify/cleanup-duplicate-mypage-response-tasks-${stamp}.csv`;
    const header = "task_id,candidate_id,candidate_number,candidate_name,previous_status,title,created_at";
    const lines = [
      header,
      ...closeTargets.map((t) =>
        [t.taskId, t.candidateId, t.candidateNumber, t.candidateName, "NOT_STARTED", t.title, t.createdAt]
          .map(csvEscape)
          .join(",")
      ),
    ];
    writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
    console.log(`  rollback CSV: ${csvPath}（${closeTargets.length} 行）`);
  }

  if (!EXECUTE) {
    console.log("");
    console.log("[cleanup-dup-tasks] DRY-RUN のため変更していません。--execute で実行。");
    return;
  }

  // 1. 重複を COMPLETED 化（ID限定）
  let closed = 0;
  const BATCH = 200;
  const ids = closeTargets.map((t) => t.taskId);
  for (let i = 0; i < ids.length; i += BATCH) {
    const r = await prisma.task.updateMany({
      where: { id: { in: ids.slice(i, i + BATCH) }, status: "NOT_STARTED" },
      data: { status: "COMPLETED" },
    });
    closed += r.count;
  }
  console.log(`[cleanup-dup-tasks] COMPLETED 化: ${closed} 件（対象 ${ids.length} 件）`);

  // 2. 残した1枚の本文を全量へ更新（求人名が1件も解決できなければ温存）
  let refreshed = 0;
  let preserved = 0;
  await mapLimit(keepTargets, 4, async (k) => {
    const responses = await prisma.candidateJobResponse.findMany({
      where: { candidateId: k.candidateId, response: { in: ["WANT_TO_APPLY", "INTERESTED"] } },
      orderBy: { respondedAt: "desc" },
    });
    const jobMap = await fetchJobMap(k.candidateNumber || null);
    if (responses.length > 0 && !responses.some((r) => jobMap.has(r.externalJobId))) {
      preserved++;
      return;
    }
    const { title, description } = buildTaskContent(k.candidateName, responses, jobMap);
    await prisma.task.update({ where: { id: k.taskId }, data: { title, description } });
    refreshed++;
  });
  console.log(`[cleanup-dup-tasks] 本文を全量更新: ${refreshed} 件 / 温存（求人名解決不能）: ${preserved} 件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

/**
 * サイト応募ブックマーク救済（過去分）。
 *
 * 背景: 旧マイページ（/v/・kyuujin candidate-response webhook）経由の「応募したい/気になる」は
 * CandidateJobResponse＋タスクは作るが CandidateFile（BOOKMARK）を作らないため、CA管理画面
 * 「紹介履歴 > ブックマーク」に出ず、CAが手作業で引き当て直していた（本不具合の本体）。
 * webhook 側は ensureBookmarkForMypageResponse で今後分を確保するようにしたので、本スクリプトは
 * 過去分（対応する BOOKMARK が無い CandidateJobResponse）を救済する。
 *
 * 対象（将幸さん確定方針: 支援中のみ）:
 *   - CandidateJobResponse.response ∈ {WANT_TO_APPLY, INTERESTED}
 *   - 候補者 supportStatus="ACTIVE"（--all-candidates で解除可）
 *   - 同一候補者×同一 kyuujinJobId(=CJR.externalJobId) の BOOKMARK 行が「一切無い」もの
 *     （@@unique([candidateId, kyuujinJobId]) はアーカイブ行も含むため archivedAt 問わず存在確認。
 *      CAが意図的にアーカイブした行がある求人は対象外＝復活させない）
 *
 * 作成行（webhook の ensureBookmarkForMypageResponse と同一慣例）:
 *   category="BOOKMARK" / origin="candidate" / kyuujinJobId=CJR.externalJobId / externalJobRef=null /
 *   sourceType=null / responseStatus=(WANT_TO_APPLY→APPLY, INTERESTED→INTERESTED) /
 *   responseStatusUpdatedAt=responseSubmittedAt=CJR.respondedAt（旧由来＝送信済み扱い） /
 *   fileName="求人票_{会社名}.pdf"（会社名は kyuujin から取得・不能時は求人IDで代替） /
 *   uploadedByUserId=システムユーザー(anonymous@local)
 *
 * 冪等: 再実行で対象0件（既存BOOKMARKを持つCJRは除外）。作成は新規行のみ・既存値の上書き/DELETEなし。
 * 巻き戻し: execute 時に作成した CandidateFile.id 一覧CSV（verify/）を削除すれば完結。
 *
 * 実行（DATABASE_URL / 任意で KYUUJIN_PDF_TOOL_URL）:
 *   npx tsx scripts/backfill-site-response-bookmarks.ts                 # DRY-RUN（既定・読み取りのみ・plan CSV出力）
 *   npx tsx scripts/backfill-site-response-bookmarks.ts --candidate 5008157  # 1名限定 DRY-RUN
 *   npx tsx scripts/backfill-site-response-bookmarks.ts --execute       # 本実行（新規行作成・rollback CSV保存）
 *   npx tsx scripts/backfill-site-response-bookmarks.ts --all-candidates # ACTIVE限定を外す（終了者含む全員）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---- 引数 ----
const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";
const ALL_CANDIDATES = argv.includes("--all-candidates");
function argVal(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const ONLY_CANDIDATE = argVal("--candidate");
const LIMIT = argVal("--limit") ? Math.max(0, parseInt(argVal("--limit")!, 10) || 0) : Infinity;

// job-introductions route / backfill-kyuujin-job-id と同じフォールバック。
const KYUUJIN_BASE =
  process.env.KYUUJIN_PDF_TOOL_URL ||
  process.env.KYUUJIN_API_URL ||
  "https://web-production-95808.up.railway.app";
const FETCH_TIMEOUT_MS = 15000;
const FETCH_GAP_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stampJST(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const RESPONSE_TO_STATUS: Record<string, "APPLY" | "INTERESTED"> = {
  WANT_TO_APPLY: "APPLY",
  INTERESTED: "INTERESTED",
};

type KyuujinJob = { id: number; company_name?: string | null };

async function fetchCandidateJobs(candidateNumber: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(
      `${KYUUJIN_BASE}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return map;
    const data = await res.json();
    if (data.jobs && Array.isArray(data.jobs)) {
      for (const j of data.jobs as KyuujinJob[]) {
        const company = (j.company_name ?? "").replace(/_\d{14,}$/, "").trim();
        map.set(j.id, company);
      }
    }
  } catch {
    /* 取得不能は空 Map（求人IDフォールバック） */
  }
  return map;
}

async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({
    where: { email: "anonymous@local" },
    select: { id: true },
  });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

type PlanRow = {
  candidateId: string;
  candidateNumber: string;
  candidateName: string;
  caName: string;
  kyuujinJobId: number;
  response: string;
  responseStatus: "APPLY" | "INTERESTED";
  companyName: string;
  fileName: string;
  respondedAt: Date;
};

async function main() {
  console.log(`\n=== サイト応募ブックマーク救済 [${MODE}] ===`);
  console.log(`スコープ: ${ALL_CANDIDATES ? "全候補者" : "ACTIVE のみ"}${ONLY_CANDIDATE ? ` / candidate=${ONLY_CANDIDATE}` : ""}${LIMIT !== Infinity ? ` / limit=${LIMIT}` : ""}`);

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    console.error("システムユーザー(anonymous@local)が見つかりません。中断。");
    process.exit(1);
  }

  // 対象 CJR を取得（応募したい/気になる）。候補者スコープは include で判定。
  const cjrs = await prisma.candidateJobResponse.findMany({
    where: {
      response: { in: ["WANT_TO_APPLY", "INTERESTED"] },
      ...(ALL_CANDIDATES ? {} : { candidate: { supportStatus: "ACTIVE" } }),
      ...(ONLY_CANDIDATE ? { candidate: { candidateNumber: ONLY_CANDIDATE } } : {}),
    },
    select: {
      candidateId: true,
      externalJobId: true,
      response: true,
      respondedAt: true,
      candidate: {
        select: {
          candidateNumber: true,
          name: true,
          supportStatus: true,
          employee: { select: { name: true } },
        },
      },
    },
    orderBy: { respondedAt: "desc" },
  });
  console.log(`対象CJR（${ALL_CANDIDATES ? "全" : "ACTIVE"}・応募/気になる）: ${cjrs.length} 件`);

  // BOOKMARK が「一切無い」CJR を抽出（archivedAt 問わず）。
  const targets: PlanRow[] = [];
  let skippedExisting = 0;
  let skippedBadJobId = 0;
  const jobMapCache = new Map<string, Map<number, string>>();

  for (const cjr of cjrs) {
    if (targets.length >= LIMIT) break;
    const kyuujinJobId = cjr.externalJobId;
    if (!Number.isInteger(kyuujinJobId) || kyuujinJobId <= 0) {
      skippedBadJobId++;
      continue;
    }

    const existing = await prisma.candidateFile.findFirst({
      where: { candidateId: cjr.candidateId, category: "BOOKMARK", kyuujinJobId },
      select: { id: true },
    });
    if (existing) {
      skippedExisting++;
      continue;
    }

    const candidateNumber = cjr.candidate.candidateNumber ?? "";
    // 会社名を候補者単位でキャッシュ取得（kyuujin API）。
    let jobMap = candidateNumber ? jobMapCache.get(candidateNumber) : undefined;
    if (candidateNumber && !jobMap) {
      jobMap = await fetchCandidateJobs(candidateNumber);
      jobMapCache.set(candidateNumber, jobMap);
      await sleep(FETCH_GAP_MS);
    }
    const company = (jobMap?.get(kyuujinJobId) || "").trim();
    const safeCompany = (company || `求人${kyuujinJobId}`).replace(/[\\/:*?"<>|]/g, "").trim();
    const fileName = `求人票_${safeCompany}.pdf`;
    const responseStatus = RESPONSE_TO_STATUS[cjr.response] ?? "INTERESTED";

    targets.push({
      candidateId: cjr.candidateId,
      candidateNumber,
      candidateName: cjr.candidate.name,
      caName: cjr.candidate.employee?.name ?? "",
      kyuujinJobId,
      response: cjr.response,
      responseStatus,
      companyName: company || `(求人ID ${kyuujinJobId})`,
      fileName,
      respondedAt: cjr.respondedAt,
    });
  }

  // 内訳
  const applyCount = targets.filter((t) => t.responseStatus === "APPLY").length;
  const interestedCount = targets.filter((t) => t.responseStatus === "INTERESTED").length;
  const uniqueCandidates = new Set(targets.map((t) => t.candidateNumber)).size;
  console.log(`\n--- 集計 ---`);
  console.log(`既存BOOKMARKありスキップ: ${skippedExisting} 件`);
  console.log(`不正jobIdスキップ:        ${skippedBadJobId} 件`);
  console.log(`救済対象（BOOKMARK新規作成予定）: ${targets.length} 件`);
  console.log(`  内訳: APPLY(応募したい) ${applyCount} 件 / INTERESTED(気になる) ${interestedCount} 件`);
  console.log(`  対象候補者: ${uniqueCandidates} 名`);

  // ---- plan CSV ----
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = stampJST();
  const modeTag = EXECUTE ? "execute" : "dryrun";
  const planPath = path.join(verifyDir, `site-response-bookmark-backfill-${modeTag}-${stamp}.csv`);
  const planLines = [
    "candidateNumber,candidateName,caName,kyuujinJobId,response,responseStatus,companyName,fileName,respondedAt",
  ];
  for (const t of targets) {
    planLines.push(
      [
        t.candidateNumber,
        t.candidateName,
        t.caName,
        t.kyuujinJobId,
        t.response,
        t.responseStatus,
        t.companyName,
        t.fileName,
        t.respondedAt.toISOString(),
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  fs.writeFileSync(planPath, planLines.join("\n"), "utf8");
  console.log(`\nplan CSV: ${planPath}`);

  if (!EXECUTE) {
    console.log(`\n[DRY-RUN] 作成は行っていません。--execute で実行してください。`);
    await pool.end();
    return;
  }

  // ---- EXECUTE: 新規BOOKMARK作成 ----
  console.log(`\n[EXECUTE] ${targets.length} 件を作成します...`);
  let created = 0;
  let failed = 0;
  const createdRows: { id: string; candidateNumber: string; kyuujinJobId: number; fileName: string }[] = [];
  for (const t of targets) {
    try {
      const row = await prisma.candidateFile.create({
        data: {
          candidateId: t.candidateId,
          category: "BOOKMARK",
          fileName: t.fileName,
          fileSize: 0,
          mimeType: "text/plain",
          driveFileId: null,
          driveViewUrl: null,
          driveFolderId: null,
          sourceType: null,
          externalJobRef: null,
          kyuujinJobId: t.kyuujinJobId,
          origin: "candidate",
          responseStatus: t.responseStatus,
          responseStatusUpdatedAt: t.respondedAt,
          responseSubmittedAt: t.respondedAt,
          uploadedByUserId: systemUserId,
        },
        select: { id: true },
      });
      created++;
      createdRows.push({
        id: row.id,
        candidateNumber: t.candidateNumber,
        kyuujinJobId: t.kyuujinJobId,
        fileName: t.fileName,
      });
    } catch (e) {
      failed++;
      console.error(`作成失敗 cand=${t.candidateNumber} job=${t.kyuujinJobId}:`, e instanceof Error ? e.message : String(e));
    }
  }

  // rollback CSV（作成した CandidateFile.id を削除すれば復元完了）
  const rbPath = path.join(verifyDir, `site-response-bookmark-backfill-rollback-${stamp}.csv`);
  const rbLines = ["candidateFileId,candidateNumber,kyuujinJobId,fileName"];
  for (const r of createdRows) {
    rbLines.push([r.id, r.candidateNumber, r.kyuujinJobId, r.fileName].map(csvEscape).join(","));
  }
  fs.writeFileSync(rbPath, rbLines.join("\n"), "utf8");

  console.log(`\n=== 完了 ===`);
  console.log(`作成: ${created} 件 / 失敗: ${failed} 件`);
  console.log(`rollback CSV: ${rbPath}`);
  console.log(`（巻き戻しは上記CSVの candidateFileId を DELETE すれば完結）`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

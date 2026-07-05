/**
 * T-133 P5: 仕分けデータの引っ越し（箱B kyuujinPDF → 箱A portal CandidateFile・複製・ACTIVEのみ）
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ ⚠⚠⚠ P4切替完了後は実行禁止 ⚠⚠⚠                                        │
 * │ 本スクリプトは「箱Bが正」の前提で箱Aを上書きする。P4で箱Aが正になった後に │
 * │ 実行すると、新しい回答を古い箱Bの状態で上書きし破壊する。               │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 対象: CandidateFile（category="BOOKMARK"・archivedAt IS NULL・kyuujinJobId 非NULL・候補者ACTIVE）
 * 書き込み先: P1新設カラムのみ（responseStatus / responseStatusUpdatedAt / responseSubmittedAt /
 *   caMatchLabel / introducedAt / excludedBy / excludedAt）＋ CandidateResponseSubmission（履歴複製）。
 *   既存カラム・箱B側への書き込みは一切なし（複製であってカットではない）。
 *
 * 箱B読み取り: railway ssh（kyuujin web 本番・/data/kyuujin.db 読み取り専用）で JSON snapshot を
 *   gzip+base64 で取得（P0実測と同じ経路）。snapshot は verify/ に保存（監査用）。
 *
 * ステータス解決（箱B get_mypage_data の _resolve_feedback_status を忠実に再現）:
 *   job.feedback_status != UNANSWERED → その値。
 *   UNANSWERED のときのみ legacy JobFeedback（job毎に updated_at 最新の行）を参照し
 *   interested→INTERESTED / apply→APPLY、それ以外は UNANSWERED。
 *
 * 日時の規則（罠#17）: 箱B SQLite の日時は datetime.utcnow() 由来の naive UTC 文字列
 *   （例 "2026-06-30T06:42:00.907257"）。UTC として解釈（末尾Z付与）し Date 化して保存。
 *
 * responseStatusUpdatedAt / responseSubmittedAt の規則（差分誤判定防止）:
 *   RULE A: 解決後 UNANSWERED → 両方 NULL（未回答）
 *   RULE B: job.feedback_status 由来（/site/・CA経路。回答は変更時に即時portal同期済み）
 *           → updatedAt = job.updated_at・submittedAt = max(送信履歴時刻, updatedAt)
 *             （updatedAt ≦ submittedAt を保証＝移行直後に「未送信差分」と誤判定しない）
 *   RULE C: legacy JobFeedback 由来（/v/ 下書き世界）
 *           → updatedAt = jf.status_changed_at ?? jf.updated_at
 *             jf.is_submitted=true  → submittedAt = max(送信時刻, updatedAt)
 *             jf.is_submitted=false → submittedAt = 送信時刻（null可）＝本物の未送信差分は未送信のまま維持
 *   送信時刻のフォールバック（ever_submitted=true だが jf.submitted_at が null の行）:
 *     jf.submitted_at → 当該候補者トークンの feedback_submissions 最終 submitted_at → job.updated_at
 *
 * FeedbackSubmission → CandidateResponseSubmission: token→job_seeker_id→ACTIVE候補者分を複製。
 *   箱Bに送信明細（どの求人を送ったか）が存在しないため Item は作成しない（counts のみ）。
 *   冪等: (candidateId, submittedAt) が既存一致する行はスキップ。
 *
 * 巻き戻し: P1新設カラムを NULL に戻す＋複製した CandidateResponseSubmission（rollback CSV の
 *   submissionId 列）を削除するだけで完結（既存データに触れていないため）。
 *
 * 実行:
 *   npx tsx scripts/t133-migrate-box-b.ts             # DRY-RUN（既定）
 *   npx tsx scripts/t133-migrate-box-b.ts --execute   # 本実行（rollback CSV 保存後に書き込み）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";
const RAILWAY_EXE = "C:/Users/mnhho/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe";
const KYUUJIN_DIR = "C:/bizstudio/kyuujin-pdf-tool";

function nowStamp(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// 箱B naive UTC 文字列 → Date（UTC解釈）。null/空は null。
function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim().replace(" ", "T");
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : t + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}
function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// ---- 箱B snapshot 型 ----
type BJob = { id: number; project_id: number; feedback_status: string | null; excluded_by: string | null; excluded_at: string | null; ca_match_label: string | null; created_at: string | null; updated_at: string | null };
type BJf = { job_id: number; token_id: number; status: string | null; is_submitted: number; ever_submitted: number; submitted_at: string | null; status_changed_at: string | null; updated_at: string | null };
type BFs = { id: number; token_id: number; submitted_at: string | null; interested_count: number; apply_count: number };
type BToken = { id: number; job_seeker_id: string | null };
type BProject = { id: number; job_seeker_id: string | null };
type Snapshot = { jobs: BJob[]; job_feedbacks: BJf[]; feedback_submissions: BFs[]; share_tokens: BToken[]; projects: BProject[] };

const SNAPSHOT_PY = `
import sqlite3, json, gzip, base64
con = sqlite3.connect("file:/data/kyuujin.db?mode=ro", uri=True)
con.row_factory = sqlite3.Row
c = con.cursor()
def rows(sql):
    return [dict(r) for r in c.execute(sql).fetchall()]
data = {
  "jobs": rows("SELECT id, project_id, feedback_status, excluded_by, excluded_at, ca_match_label, created_at, updated_at FROM jobs"),
  "job_feedbacks": rows("SELECT job_id, token_id, status, is_submitted, ever_submitted, submitted_at, status_changed_at, updated_at FROM job_feedbacks"),
  "feedback_submissions": rows("SELECT id, token_id, submitted_at, interested_count, apply_count FROM feedback_submissions"),
  "share_tokens": rows("SELECT id, job_seeker_id FROM share_tokens"),
  "projects": rows("SELECT id, job_seeker_id FROM projects"),
}
con.close()
payload = base64.b64encode(gzip.compress(json.dumps(data, default=str).encode())).decode()
print("SNAPSHOT_B64_START")
print(payload)
print("SNAPSHOT_B64_END")
`;

function fetchSnapshot(): Snapshot {
  console.log("箱B snapshot を取得中（railway ssh・読み取り専用）...");
  const b64py = Buffer.from(SNAPSHOT_PY, "utf8").toString("base64");
  const out = execFileSync(RAILWAY_EXE, ["ssh", `echo ${b64py} | base64 -d | python3`], {
    cwd: KYUUJIN_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const m = out.match(/SNAPSHOT_B64_START\s+([A-Za-z0-9+/=\s]+?)\s+SNAPSHOT_B64_END/);
  if (!m) throw new Error("snapshot マーカーが見つからない（railway ssh 出力異常）");
  const json = zlib.gunzipSync(Buffer.from(m[1].replace(/\s+/g, ""), "base64")).toString("utf8");
  return JSON.parse(json) as Snapshot;
}

// 箱B _resolve_feedback_status の忠実再現
function resolveStatus(job: BJob, jf: BJf | undefined): string {
  const current = job.feedback_status || "UNANSWERED";
  if (current !== "UNANSWERED") return current;
  if (jf?.status === "interested") return "INTERESTED";
  if (jf?.status === "apply") return "APPLY";
  return "UNANSWERED";
}

async function main() {
  console.log("=".repeat(72));
  console.log(`⚠ T-133 P5 箱B→箱A 移行 (mode=${MODE})`);
  console.log(`⚠ 本スクリプトは「箱Bが正」の前提。P4切替完了後は実行禁止（箱Aを破壊する）。`);
  console.log("=".repeat(72));

  const snap = fetchSnapshot();
  console.log(`snapshot: jobs=${snap.jobs.length} jf=${snap.job_feedbacks.length} fs=${snap.feedback_submissions.length} tokens=${snap.share_tokens.length} projects=${snap.projects.length}`);

  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = nowStamp();
  const snapPath = path.join(verifyDir, `t133-boxb-snapshot-${stamp}.json.gz`);
  fs.writeFileSync(snapPath, zlib.gzipSync(JSON.stringify(snap)));
  console.log(`snapshot 保存（監査用）: ${snapPath}`);

  // ---- インデックス ----
  const jobsById = new Map(snap.jobs.map((j) => [j.id, j]));
  // job毎に updated_at 最新の legacy JobFeedback
  const jfByJobId = new Map<number, BJf>();
  for (const jf of snap.job_feedbacks) {
    const cur = jfByJobId.get(jf.job_id);
    if (!cur || (utcDate(jf.updated_at)?.getTime() ?? 0) > (utcDate(cur.updated_at)?.getTime() ?? 0)) {
      jfByJobId.set(jf.job_id, jf);
    }
  }
  const tokenSeeker = new Map(snap.share_tokens.map((t) => [t.id, t.job_seeker_id]));
  const projectSeeker = new Map(snap.projects.map((p) => [p.id, p.job_seeker_id]));
  // 候補者(番号)毎の feedback_submissions 最終 submitted_at（送信時刻フォールバック用）
  const lastFsBySeeker = new Map<string, Date>();
  for (const f of snap.feedback_submissions) {
    const seeker = tokenSeeker.get(f.token_id);
    const at = utcDate(f.submitted_at);
    if (!seeker || !at) continue;
    const cur = lastFsBySeeker.get(seeker);
    if (!cur || at.getTime() > cur.getTime()) lastFsBySeeker.set(seeker, at);
  }

  // ---- portal 対象行 ----
  const targets = await prisma.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      archivedAt: null,
      kyuujinJobId: { not: null },
      candidate: { supportStatus: "ACTIVE" },
    },
    select: {
      id: true, kyuujinJobId: true, fileName: true,
      responseStatus: true, responseStatusUpdatedAt: true, responseSubmittedAt: true,
      caMatchLabel: true, introducedAt: true, excludedBy: true, excludedAt: true,
      candidate: { select: { id: true, candidateNumber: true, name: true } },
    },
  });
  console.log(`portal対象行（BOOKMARK×active×kyuujinJobId有×ACTIVE）: ${targets.length}件 / 候補者 ${new Set(targets.map((t) => t.candidate.id)).size}名`);

  // ---- 計画作成 ----
  type Plan = {
    fileId: string; candidateNumber: string; jobId: number;
    responseStatus: string; updatedAt: Date | null; submittedAt: Date | null;
    caMatchLabel: string | null; introducedAt: Date | null;
    excludedBy: string | null; excludedAt: Date | null;
    rule: "A" | "B" | "C";
  };
  const plans: Plan[] = [];
  let jobMissing = 0;
  const statusCount: Record<string, number> = {};

  for (const t of targets) {
    const job = jobsById.get(t.kyuujinJobId!);
    if (!job) { jobMissing++; continue; } // 箱Bに該当jobなし（削除済み等）→書き込まない
    const jf = jfByJobId.get(job.id);
    const status = resolveStatus(job, jf);
    statusCount[status] = (statusCount[status] ?? 0) + 1;

    let rule: Plan["rule"];
    let updatedAt: Date | null = null;
    let submittedAt: Date | null = null;
    if (status === "UNANSWERED") {
      rule = "A";
    } else if ((job.feedback_status || "UNANSWERED") !== "UNANSWERED") {
      rule = "B";
      updatedAt = utcDate(job.updated_at);
      const submitBase = jf?.ever_submitted
        ? (utcDate(jf.submitted_at) ?? lastFsBySeeker.get(t.candidate.candidateNumber ?? "") ?? updatedAt)
        : updatedAt; // /site/・CA経路は変更時に即時同期済み＝送信済み扱い
      submittedAt = maxDate(submitBase, updatedAt);
    } else {
      rule = "C"; // legacy由来（/v/ 下書き世界）
      updatedAt = utcDate(jf!.status_changed_at) ?? utcDate(jf!.updated_at);
      const submitTime = jf!.ever_submitted
        ? (utcDate(jf!.submitted_at) ?? lastFsBySeeker.get(t.candidate.candidateNumber ?? "") ?? updatedAt)
        : null;
      submittedAt = jf!.is_submitted ? maxDate(submitTime, updatedAt) : submitTime;
    }

    plans.push({
      fileId: t.id,
      candidateNumber: t.candidate.candidateNumber ?? "",
      jobId: job.id,
      responseStatus: status,
      updatedAt,
      submittedAt,
      caMatchLabel: job.ca_match_label,
      introducedAt: utcDate(job.created_at),
      excludedBy: job.excluded_by,
      excludedAt: utcDate(job.excluded_at),
      rule,
    });
  }

  // 箱B側 ACTIVE候補者の突合不能行（箱Aに対応行なし）の件数
  const activeNums = new Set(targets.map((t) => t.candidate.candidateNumber).filter(Boolean) as string[]);
  const activeCandsAll = await prisma.candidate.findMany({
    where: { supportStatus: "ACTIVE", candidateNumber: { not: "" } },
    select: { candidateNumber: true },
  });
  const activeAllNums = new Set(activeCandsAll.map((c) => c.candidateNumber));
  const matchedJobIds = new Set(plans.map((p) => p.jobId));
  let unmatchedBoxB = 0;
  const unmatchedByStatus: Record<string, number> = {};
  for (const job of snap.jobs) {
    const seeker = projectSeeker.get(job.project_id);
    if (!seeker || !activeAllNums.has(seeker)) continue;
    if (matchedJobIds.has(job.id)) continue;
    unmatchedBoxB++;
    const st = resolveStatus(job, jfByJobId.get(job.id));
    unmatchedByStatus[st] = (unmatchedByStatus[st] ?? 0) + 1;
  }

  // ---- Submission 複製計画（ACTIVE候補者分・冪等: candidateId+submittedAt 一致はスキップ） ----
  const numToCandidateId = new Map<string, string>();
  for (const t of targets) if (t.candidate.candidateNumber) numToCandidateId.set(t.candidate.candidateNumber, t.candidate.id);
  // targets に出ない ACTIVE 候補者（紐付き行ゼロ）でも submission は複製対象になり得るため補完
  const restActive = await prisma.candidate.findMany({
    where: { supportStatus: "ACTIVE", candidateNumber: { in: [...new Set(snap.feedback_submissions.map((f) => tokenSeeker.get(f.token_id)).filter(Boolean) as string[])] } },
    select: { id: true, candidateNumber: true },
  });
  for (const c of restActive) numToCandidateId.set(c.candidateNumber, c.id);

  type SubPlan = { candidateId: string; candidateNumber: string; submittedAt: Date; interestedCount: number; applyCount: number };
  const subPlans: SubPlan[] = [];
  let fsSkippedNonActive = 0;
  for (const f of snap.feedback_submissions) {
    const seeker = tokenSeeker.get(f.token_id);
    const at = utcDate(f.submitted_at);
    if (!seeker || !at) { fsSkippedNonActive++; continue; }
    const cid = numToCandidateId.get(seeker);
    if (!cid || !activeAllNums.has(seeker)) { fsSkippedNonActive++; continue; }
    subPlans.push({ candidateId: cid, candidateNumber: seeker, submittedAt: at, interestedCount: f.interested_count ?? 0, applyCount: f.apply_count ?? 0 });
  }

  // ---- サマリ ----
  console.log(`\n=== 移行計画サマリ ===`);
  console.log(`  書き込み対象行: ${plans.length}（箱Bにjobなしでスキップ: ${jobMissing}）`);
  console.log(`  responseStatus 内訳: ${JSON.stringify(statusCount)}`);
  const ruleCount = { A: 0, B: 0, C: 0 } as Record<string, number>;
  for (const p of plans) ruleCount[p.rule]++;
  console.log(`  規則別: RULE A(未回答)=${ruleCount.A} / B(feedback_status由来)=${ruleCount.B} / C(legacy由来)=${ruleCount.C}`);
  console.log(`  箱B側ACTIVE突合不能（箱Aに対応行なし・書き込まない）: ${unmatchedBoxB}件 内訳=${JSON.stringify(unmatchedByStatus)}`);
  console.log(`  Submission複製: ${subPlans.length}件（非ACTIVE/解決不能スキップ: ${fsSkippedNonActive}）`);
  // 未送信差分の健全性（移行直後に diff と判定される行数）
  const pendingDiff = plans.filter((p) => ["INTERESTED", "APPLY", "PENDING"].includes(p.responseStatus) && p.updatedAt && (!p.submittedAt || p.updatedAt.getTime() > p.submittedAt.getTime()));
  console.log(`  移行直後に「未送信差分」と判定される行: ${pendingDiff.length}件（/v/の本物の未送信下書きのみ想定）`);

  // ---- rollback CSV（現在値と書き込み予定値の対応） ----
  const rbPath = path.join(verifyDir, `t133-migrate-rollback-${MODE.toLowerCase()}-${stamp}.csv`);
  const rb = [["fileId","candidateNumber","jobId","cur_status","cur_updatedAt","cur_submittedAt","cur_caMatchLabel","cur_introducedAt","cur_excludedBy","cur_excludedAt","new_status","new_updatedAt","new_submittedAt","new_caMatchLabel","new_introducedAt","new_excludedBy","new_excludedAt","rule"].join(",")];
  const curById = new Map(targets.map((t) => [t.id, t]));
  for (const p of plans) {
    const c = curById.get(p.fileId)!;
    rb.push([
      p.fileId, p.candidateNumber, p.jobId,
      c.responseStatus, c.responseStatusUpdatedAt?.toISOString(), c.responseSubmittedAt?.toISOString(), c.caMatchLabel, c.introducedAt?.toISOString(), c.excludedBy, c.excludedAt?.toISOString(),
      p.responseStatus, p.updatedAt?.toISOString(), p.submittedAt?.toISOString(), p.caMatchLabel, p.introducedAt?.toISOString(), p.excludedBy, p.excludedAt?.toISOString(),
      p.rule,
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(rbPath, rb.join("\n"), "utf8");
  console.log(`\nrollback CSV: ${rbPath}`);
  console.log(`（巻き戻し = 対象fileIdのP1新設7カラムをNULLへ＋複製Submission(下記CSVのsubmissionId)を削除で完結）`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 書き込みなし。--execute で実行)`);
    await prisma.$disconnect(); await pool.end();
    return;
  }

  // ---- EXECUTE ----
  console.log(`\n=== EXECUTE: 行更新 ${plans.length}件 ===`);
  let ok = 0, err = 0;
  for (const p of plans) {
    try {
      await prisma.candidateFile.update({
        where: { id: p.fileId },
        data: {
          responseStatus: p.responseStatus,
          responseStatusUpdatedAt: p.updatedAt,
          responseSubmittedAt: p.submittedAt,
          caMatchLabel: p.caMatchLabel,
          introducedAt: p.introducedAt,
          excludedBy: p.excludedBy,
          excludedAt: p.excludedAt,
        },
      });
      ok++;
    } catch (e) {
      err++;
      console.error(`  ✗ ${p.fileId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`  行更新: 成功=${ok} / 失敗=${err}`);

  console.log(`=== EXECUTE: Submission 複製 ===`);
  let subCreated = 0, subSkipped = 0;
  const createdSubIds: string[] = [];
  for (const s of subPlans) {
    const exists = await prisma.candidateResponseSubmission.findFirst({
      where: { candidateId: s.candidateId, submittedAt: s.submittedAt },
      select: { id: true },
    });
    if (exists) { subSkipped++; continue; }
    const created = await prisma.candidateResponseSubmission.create({
      data: {
        candidateId: s.candidateId,
        submittedAt: s.submittedAt,
        interestedCount: s.interestedCount,
        applyCount: s.applyCount,
      },
      select: { id: true },
    });
    createdSubIds.push(created.id);
    subCreated++;
  }
  console.log(`  Submission: 作成=${subCreated} / 既存スキップ=${subSkipped}`);
  if (createdSubIds.length) {
    const subCsv = path.join(verifyDir, `t133-migrate-submissions-${stamp}.csv`);
    fs.writeFileSync(subCsv, ["submissionId", ...createdSubIds].join("\n"), "utf8");
    console.log(`  複製SubmissionのID一覧（巻き戻し用）: ${subCsv}`);
  }

  // ---- 事後の集計一致検証（箱A側） ----
  const after = await prisma.candidateFile.groupBy({
    by: ["responseStatus"],
    where: { category: "BOOKMARK", archivedAt: null, kyuujinJobId: { not: null }, candidate: { supportStatus: "ACTIVE" } },
    _count: true,
  });
  console.log(`\n=== 事後検証: 箱A responseStatus 別件数（ACTIVE×紐付き） ===`);
  for (const a of after) console.log(`  ${a.responseStatus ?? "(null)"}: ${a._count}`);
  console.log(`  （計画時の箱B解決値内訳: ${JSON.stringify(statusCount)} と一致すること）`);

  await prisma.$disconnect(); await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch { /* noop */ }
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});

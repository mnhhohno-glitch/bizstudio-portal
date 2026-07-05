/**
 * 求人ID紐付け化 step4: 過去分バックフィル。
 * 支援中(supportStatus=ACTIVE)候補者の、kyuujinPDF送信済みブックマーク
 * (CandidateFile category="BOOKMARK", archivedAt=null, lastExportedAt≠null)のうち kyuujinJobId=null の行に、
 * kyuujinPDF の Job 内部ID(jobs.id・Int)を「文字突合のみ」で後付けする。AI/Gemini呼び出しは一切なし。
 * ※sourceType は条件に含めない（T-131 で sourceType が変わった行も対象。実際に送った行の絞りは lastExportedAt≠null）。
 *
 * 取得元: 既存API GET {KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/{candidateNumber}/jobs
 *   （認証不要・読み取りのみ）。jobs[] の各要素: { id, job_id, job_db, company_name, ... }
 *
 * 照合方法（候補者スコープ内・優先順・すべて1対1: 1ジョブIDは1ファイルにのみ割当。曖昧は書かない）:
 *   方法1 Circus番号: job_db="Circus" のジョブで、fileName の `_No{数字}` == job.job_id（一意ヒットのみ）
 *   方法2 会社名+時刻の完全一致: fileName から `求人票_`接頭辞・先頭`{id}_`・`.pdf` を除いた文字列が
 *          job.company_name と完全一致（HITO-Link/マイナビは会社名末尾に同一の14〜17桁タイムスタンプが
 *          両側に付くため実質ユニークキー。一意ヒットのみ）
 *   方法3 Bee番号: fileName 末尾の `：{数字}`/`:{数字}` == job.job_id（一意ヒットのみ）
 *   方法4 正規化会社名の一意ペア: 正規化会社名(拡張子/接頭辞/`_No{n}`/`:num`/タイムスタンプ/法人格/空白 除去)が
 *          一致し、かつ その候補者内で「該当ブックマーク1件 × 該当ジョブ1件」の一意ペアのときのみ採用
 *   上記いずれも決まらない → 書き込まず unmatched として一覧化（誤照合防止を最優先）
 *
 * 冪等: kyuujinJobId が既に入っている行はクエリで除外（step2で付いた分の上書き禁止）。再実行安全。
 * 1対1: 同一候補者内で1つの job.id を複数ファイルに割り当てない（claimed 管理。重複は後続を unmatched へ）。
 * 同名複数行は lastExportedAt 降順で先に処理し「最新エクスポート行」が先に確定（step1 webhook と一致）。
 *
 * 実行（DATABASE_URL / 任意で KYUUJIN_PDF_TOOL_URL が要る。URL未設定時は既知の本番URLへフォールバック）:
 *   npx tsx scripts/backfill-kyuujin-job-id.ts                    # DRY-RUN（既定・読み取りのみ）
 *   npx tsx scripts/backfill-kyuujin-job-id.ts --candidate 5004402 # 1名限定 DRY-RUN
 *   npx tsx scripts/backfill-kyuujin-job-id.ts --execute          # 本実行（rollback CSV 保存後に UPDATE）
 *   npx tsx scripts/backfill-kyuujin-job-id.ts --execute --limit 50
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
function argVal(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const ONLY_CANDIDATE = argVal("--candidate"); // candidateNumber 指定で1名限定
const LIMIT = argVal("--limit") ? Math.max(0, parseInt(argVal("--limit")!, 10) || 0) : Infinity;

// job-introductions route と同じフォールバック（KYUUJIN_PDF_TOOL_URL 優先、無ければ既知の本番URL）。
const KYUUJIN_BASE =
  process.env.KYUUJIN_PDF_TOOL_URL ||
  process.env.KYUUJIN_API_URL ||
  "https://web-production-95808.up.railway.app";

const FETCH_TIMEOUT_MS = 15000;
const FETCH_GAP_MS = 150; // 候補者間の軽い間隔

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 文字突合ヘルパ ----
function noNumFromName(fn: string): string | null {
  const m = fn.match(/_No(\d+)/i);
  return m ? m[1] : null;
}
function beeNumFromName(fn: string): string | null {
  const m = fn.replace(/\.pdf$/i, "").match(/[：:](\d+)$/);
  return m ? m[1] : null;
}
// 求人票_接頭辞・先頭{id}_・.pdf を除去した「会社名+時刻」キー（company_name と完全一致比較用）
function nameKeyExact(fn: string): string {
  return fn.replace(/\.pdf$/i, "").replace(/^求人票_/, "").replace(/^\d+_/, "").trim();
}
// 正規化会社名（法人格・タイムスタンプ・番号・空白を除去）
function normCompany(s: string): string {
  return s
    .replace(/\.pdf$/i, "")
    .replace(/^求人票_/, "")
    .replace(/^\d+_/, "")
    .replace(/_No\d+$/i, "")
    .replace(/[：:]\d+$/, "")
    .replace(/_\d{10,}$/, "")
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[\s　]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .trim();
}

function ts(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // JST
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- 型 ----
type KyuujinJob = {
  id: number;
  job_id?: string | null;
  job_db?: string | null;
  company_name?: string | null;
};
type Bookmark = {
  id: string;
  fileName: string;
  lastExportedAt: Date | null;
  lastExportedTo: string | null;
};
type Match = {
  candidateNumber: string;
  candidateName: string;
  fileId: string;
  fileName: string;
  method: 1 | 2 | 3 | 4;
  kyuujinJobId: number;
  jobCompanyName: string;
};
type Unmatched = {
  candidateNumber: string;
  candidateName: string;
  fileId: string;
  fileName: string;
  reason: string;
};

async function fetchJobs(candidateNumber: string): Promise<{ jobs: KyuujinJob[]; ok: boolean; note: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${KYUUJIN_BASE}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
      { signal: controller.signal, headers: { "User-Agent": "bizstudio-portal-backfill/1.0" } },
    );
    if (res.status === 404) return { jobs: [], ok: true, note: "no-project(404)" };
    if (!res.ok) return { jobs: [], ok: false, note: `HTTP ${res.status}` };
    const data = (await res.json()) as { jobs?: KyuujinJob[] };
    return { jobs: Array.isArray(data.jobs) ? data.jobs : [], ok: true, note: "ok" };
  } catch (e) {
    return { jobs: [], ok: false, note: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// 1候補者分の突合。Match と Unmatched を返す（DBは触らない）。
function matchCandidate(
  candidateNumber: string,
  candidateName: string,
  bookmarks: Bookmark[],
  jobs: KyuujinJob[],
  apiFailed: boolean,
): { matches: Match[]; unmatched: Unmatched[] } {
  const matches: Match[] = [];
  const unmatched: Unmatched[] = [];

  if (apiFailed) {
    for (const b of bookmarks) {
      unmatched.push({ candidateNumber, candidateName, fileId: b.id, fileName: b.fileName, reason: "api-error" });
    }
    return { matches, unmatched };
  }

  // ジョブ側インデックス
  const circusByNo = new Map<string, KyuujinJob[]>();
  const companyExact = new Map<string, KyuujinJob[]>();
  const beeByJobId = new Map<string, KyuujinJob[]>();
  const jobByNorm = new Map<string, KyuujinJob[]>();
  const push = (m: Map<string, KyuujinJob[]>, k: string, j: KyuujinJob) => {
    const a = m.get(k); if (a) a.push(j); else m.set(k, [j]);
  };
  for (const j of jobs) {
    if (j.job_db === "Circus" && j.job_id) push(circusByNo, String(j.job_id), j);
    if (j.company_name) push(companyExact, j.company_name, j);
    if (j.job_id) push(beeByJobId, String(j.job_id), j);
    const nk = j.company_name ? normCompany(j.company_name) : "";
    if (nk) push(jobByNorm, nk, j);
  }
  // ブックマーク側の正規化名の多重度（方法4の「1件×1件」判定用）
  const bmNorm = new Map<string, number>();
  for (const b of bookmarks) {
    const k = normCompany(b.fileName);
    if (k) bmNorm.set(k, (bmNorm.get(k) ?? 0) + 1);
  }

  const claimed = new Set<number>(); // このリクエストで割当済みの job.id（1対1）
  // 最新エクスポート行を優先（step1 webhook と一致）
  const ordered = [...bookmarks].sort(
    (a, b) => (b.lastExportedAt?.getTime() ?? 0) - (a.lastExportedAt?.getTime() ?? 0),
  );

  for (const b of ordered) {
    const avail = (arr: KyuujinJob[] | undefined) => (arr ?? []).filter((j) => !claimed.has(j.id));
    let hit: KyuujinJob | null = null;
    let method: 1 | 2 | 3 | 4 | null = null;

    // 方法1: Circus番号
    const no = noNumFromName(b.fileName);
    if (no) {
      const arr = avail(circusByNo.get(no));
      if (arr.length === 1) { hit = arr[0]; method = 1; }
    }
    // 方法2: 会社名+時刻の完全一致
    if (!hit) {
      const key = nameKeyExact(b.fileName);
      const arr = avail(companyExact.get(key));
      if (arr.length === 1) { hit = arr[0]; method = 2; }
    }
    // 方法3: Bee番号
    if (!hit) {
      const bee = beeNumFromName(b.fileName);
      if (bee) {
        const arr = avail(beeByJobId.get(bee));
        if (arr.length === 1) { hit = arr[0]; method = 3; }
      }
    }
    // 方法4: 正規化会社名の一意ペア（両側1件）
    if (!hit) {
      const nk = normCompany(b.fileName);
      if (nk && (bmNorm.get(nk) ?? 0) === 1) {
        const arr = avail(jobByNorm.get(nk));
        if (arr.length === 1) { hit = arr[0]; method = 4; }
      }
    }

    if (hit && method) {
      claimed.add(hit.id);
      matches.push({
        candidateNumber, candidateName, fileId: b.id, fileName: b.fileName,
        method, kyuujinJobId: hit.id, jobCompanyName: hit.company_name ?? "",
      });
    } else {
      const reason = jobs.length === 0 ? "no-jobs-for-candidate" : "no-unique-match";
      unmatched.push({ candidateNumber, candidateName, fileId: b.id, fileName: b.fileName, reason });
    }
  }
  return { matches, unmatched };
}

async function main() {
  console.log(`=== 求人ID紐付け step4 バックフィル (mode=${MODE}) ===`);
  console.log(`kyuujin API base: ${KYUUJIN_BASE}`);
  if (ONLY_CANDIDATE) console.log(`対象を candidateNumber=${ONLY_CANDIDATE} に限定`);
  if (LIMIT !== Infinity) console.log(`limit=${LIMIT}`);

  // 対象ブックマークを候補者ごとに取得
  const rows = await prisma.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      // sourceType 条件は外す（T-131 で sourceType が書き換わった行があっても、PDF由来ブックマークで
      // kyuujinJobId が必要な事実は不変。実際に kyuujinPDF へ送った行に絞るのは lastExportedAt≠null が担う）。
      archivedAt: null,
      lastExportedAt: { not: null },
      kyuujinJobId: null,
      candidate: {
        supportStatus: "ACTIVE",
        ...(ONLY_CANDIDATE ? { candidateNumber: ONLY_CANDIDATE } : {}),
      },
    },
    select: {
      id: true, fileName: true, lastExportedAt: true, lastExportedTo: true, sourceType: true,
      candidate: { select: { candidateNumber: true, name: true, supportStatus: true } },
    },
    orderBy: { lastExportedAt: "desc" },
  });

  // 対象健全性チェック: sourceType 内訳 と ACTIVE 限定の崩れ確認
  const bySourceType: Record<string, number> = {};
  const nonActive: string[] = [];
  for (const r of rows) {
    const st = r.sourceType === null ? "null" : r.sourceType;
    bySourceType[st] = (bySourceType[st] ?? 0) + 1;
    if (r.candidate.supportStatus !== "ACTIVE") nonActive.push(`${r.candidate.candidateNumber}(${r.candidate.supportStatus})`);
  }

  // 候補者ごとにグループ化（candidateNumber が null の行は対象外＝APIキー無し）
  const byCand = new Map<string, { name: string; bms: Bookmark[] }>();
  let skippedNoNumber = 0;
  for (const r of rows) {
    const num = r.candidate.candidateNumber;
    if (!num) { skippedNoNumber++; continue; }
    const g = byCand.get(num) ?? { name: r.candidate.name, bms: [] };
    g.bms.push({ id: r.id, fileName: r.fileName, lastExportedAt: r.lastExportedAt, lastExportedTo: r.lastExportedTo });
    byCand.set(num, g);
  }

  console.log(`対象: ${rows.length}件 / 候補者 ${byCand.size}名${skippedNoNumber ? `（candidateNumber無しで除外 ${skippedNoNumber}件）` : ""}`);
  console.log(`  sourceType内訳: ${JSON.stringify(bySourceType)}`);
  console.log(`  ACTIVE限定チェック: ${nonActive.length === 0 ? "OK（全行ACTIVE）" : `⚠ 非ACTIVE混入 ${nonActive.length}件: ${[...new Set(nonActive)].slice(0, 5).join(", ")}`}`);

  const allMatches: Match[] = [];
  const allUnmatched: Unmatched[] = [];
  const apiErrors: string[] = [];
  let processed = 0;

  for (const [num, g] of byCand) {
    if (allMatches.length >= LIMIT) break;
    const { jobs, ok, note } = await fetchJobs(num);
    if (!ok) apiErrors.push(`${num}(${g.name}): ${note}`);
    const { matches, unmatched } = matchCandidate(num, g.name, g.bms, jobs, !ok);
    allMatches.push(...matches);
    allUnmatched.push(...unmatched);
    processed++;
    if (processed % 10 === 0) console.log(`  ...${processed}/${byCand.size}名 処理（matched=${allMatches.length} unmatched=${allUnmatched.length}）`);
    await sleep(FETCH_GAP_MS);
  }

  // LIMIT 適用（matches のみ上限。dry-run 見積り用）
  const matchesToApply = LIMIT === Infinity ? allMatches : allMatches.slice(0, LIMIT);

  // 集計
  const byMethod = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<number, number>;
  for (const m of matchesToApply) byMethod[m.method]++;
  console.log(`\n=== 突合結果サマリ ===`);
  console.log(`  matched 合計: ${matchesToApply.length}`);
  console.log(`    方法1 Circus番号(_No==job_id):        ${byMethod[1]}`);
  console.log(`    方法2 会社名+時刻の完全一致:          ${byMethod[2]}`);
  console.log(`    方法3 Bee番号(：num==job_id):          ${byMethod[3]}`);
  console.log(`    方法4 正規化会社名の一意ペア:          ${byMethod[4]}`);
  console.log(`  unmatched 合計: ${allUnmatched.length}`);
  const unByReason: Record<string, number> = {};
  for (const u of allUnmatched) unByReason[u.reason] = (unByReason[u.reason] ?? 0) + 1;
  console.log(`    内訳: ${JSON.stringify(unByReason)}`);
  if (apiErrors.length) console.log(`  ⚠ API取得失敗 ${apiErrors.length}名: ${apiErrors.slice(0, 5).join(" / ")}${apiErrors.length > 5 ? " ..." : ""}`);

  // ---- CSV 出力 ----
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  const modeTag = MODE.toLowerCase();

  // 突合予定 CSV
  const planPath = path.join(verifyDir, `kyuujin-job-id-backfill-${modeTag}-${stamp}.csv`);
  const planLines = [["candidateNumber", "candidateName", "fileId", "fileName", "method", "kyuujinJobId", "jobCompanyName"].join(",")];
  for (const m of matchesToApply) {
    planLines.push([m.candidateNumber, m.candidateName, m.fileId, m.fileName, m.method, m.kyuujinJobId, m.jobCompanyName].map(csvEscape).join(","));
  }
  fs.writeFileSync(planPath, planLines.join("\n"), "utf8");
  console.log(`\n突合予定 CSV: ${planPath}`);

  // unmatched CSV（候補者の保有ジョブ一覧は膨大になるため、理由と件数で代替。必要時は --candidate で個別確認）
  const unPath = path.join(verifyDir, `kyuujin-job-id-backfill-unmatched-${modeTag}-${stamp}.csv`);
  const unLines = [["candidateNumber", "candidateName", "fileId", "fileName", "reason"].join(",")];
  for (const u of allUnmatched) unLines.push([u.candidateNumber, u.candidateName, u.fileId, u.fileName, u.reason].map(csvEscape).join(","));
  fs.writeFileSync(unPath, unLines.join("\n"), "utf8");
  console.log(`unmatched CSV: ${unPath}`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 書き込み未実行。本実行は --execute を付与。)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ---- EXECUTE ----
  // rollback CSV（全対象は kyuujinJobId=null からの変更。これらの fileId を null に戻せば復元完了）
  const rbPath = path.join(verifyDir, `kyuujin-job-id-backfill-rollback-execute-${stamp}.csv`);
  const rbLines = [["fileId", "candidateNumber", "fileName", "before_kyuujinJobId", "after_kyuujinJobId"].join(",")];
  for (const m of matchesToApply) rbLines.push([m.fileId, m.candidateNumber, m.fileName, "", m.kyuujinJobId].map(csvEscape).join(","));
  fs.writeFileSync(rbPath, rbLines.join("\n"), "utf8");
  console.log(`\nRollback CSV: ${rbPath}（この fileId 群を kyuujin_job_id=NULL に戻せば復元）`);

  console.log(`\n=== EXECUTE: ${matchesToApply.length}件を書き込み ===`);
  let ok = 0, err = 0, skipped = 0;
  for (const m of matchesToApply) {
    try {
      // 冪等・安全: kyuujinJobId が null の行だけを更新（他プロセスが先に埋めたら触らない）
      const res = await prisma.candidateFile.updateMany({
        where: { id: m.fileId, kyuujinJobId: null },
        data: { kyuujinJobId: m.kyuujinJobId },
      });
      if (res.count === 1) ok++;
      else skipped++; // 既に埋まっていた等
    } catch (e) {
      err++;
      console.error(`  ✗ update failed fileId=${m.fileId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`  書き込み: 成功=${ok} / スキップ(既存)=${skipped} / 失敗=${err}`);
  console.log(`  期待成功件数=${matchesToApply.length}（成功+スキップ = ${ok + skipped}）`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});

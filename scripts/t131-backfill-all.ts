/**
 * T-131 step4: 過去アップPDF（本機能ローンチ前の遡及分）の全量フルデータ化バッチ。
 *
 * PDF由来ブックマーク（sourceType=NULL）で未紐付け（externalJobRef=NULL）の全期間分を、
 * job-platform の内部投入API（POST /api/internal/ingest-pdf・step2 と同経路）へ 1件ずつ投入し、
 * 成功で externalJobRef/platformSubmittedAt を書き戻す。非公開求人として登録される（削除なし）。
 *
 * 特徴:
 *   - 既定 DRY-RUN（対象件数・候補者数・概算費用・概算所要のみ表示。DB/HTTP非接触）
 *   - --execute で本実行。--workers N（既定4）で並列度、--limit N で件数上限
 *   - レジューム可能: verify/t131-backfill-progress.jsonl に処理済み/失敗IDを追記。
 *     再実行時はそれらをスキップし未処理分だけ続きから走る（中断・PC再起動に耐える）
 *   - 429/5xx/タイムアウトは指数バックオフで最大3回リトライ→なお失敗はスキップして失敗記録
 *   - 60秒ごとに進捗（処理/残/失敗/経過/完了予測時刻）を出力
 *   - daily-ingest（JST 6:30）との競合回避: JST 06:00–06:45 は自動一時停止→06:45再開
 *   - 二重投入防御: (1) 本クエリが externalJobRef!=NULL を除外 (2) JSONL済みをスキップ
 *     (3) job-platform 側が同一媒体×PDF内容ハッシュを dedup（status="duplicate"）
 *
 * 実行（本番コンテナ上・要 INTERNAL_INGEST_API_KEY / GOOGLE_SERVICE_ACCOUNT_KEY / DATABASE_URL）:
 *   railway ssh
 *   npx tsx scripts/t131-backfill-all.ts                        # DRY-RUN（見積り）
 *   npx tsx scripts/t131-backfill-all.ts --execute              # 本実行（並列4・全量）
 *   npx tsx scripts/t131-backfill-all.ts --execute --limit 20   # 一部だけ
 *   npx tsx scripts/t131-backfill-all.ts --execute --workers 2  # 並列度変更
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { submitPdfToJobPlatform, type IngestResult } from "@/lib/job-platform-ingest";

// ---- 引数 ----
const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
function argVal(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const WORKERS = Math.max(1, parseInt(argVal("--workers") ?? "4", 10) || 4);
const LIMIT = argVal("--limit") ? Math.max(0, parseInt(argVal("--limit")!, 10) || 0) : Infinity;

// ---- 定数 ----
const COST_PER_ITEM_YEN = 0.59; // 1件あたり概算費用
const SECONDS_PER_ITEM = 41; // Gemini構造化の実測処理時間/件
const MAX_ATTEMPTS = 3;
const PROGRESS_PATH = path.join(process.cwd(), "verify", "t131-backfill-progress.jsonl");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ts(): string {
  return new Date().toISOString();
}
function log(msg: string) {
  console.log(`[t131-backfill ${ts()}] ${msg}`);
}

// ---- 進捗ファイル（レジューム） ----
type ProgressRec = {
  fileId: string;
  status: "ok" | "failed";
  sourceJobId?: string;
  deduped?: boolean;
  error?: string;
  ts: string;
};

function loadHandled(): Map<string, string> {
  const handled = new Map<string, string>();
  if (!fs.existsSync(PROGRESS_PATH)) return handled;
  const lines = fs.readFileSync(PROGRESS_PATH, "utf8").split("\n").filter(Boolean);
  for (const ln of lines) {
    try {
      const rec = JSON.parse(ln) as ProgressRec;
      if (rec.fileId) handled.set(rec.fileId, rec.status);
    } catch {
      /* 壊れた行はスキップ */
    }
  }
  return handled;
}

function appendProgress(rec: ProgressRec) {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.appendFileSync(PROGRESS_PATH, JSON.stringify(rec) + "\n");
}

// ---- リトライ判定 ----
function isRetryable(err: string): boolean {
  if (/HTTP (429|5\d\d)/.test(err)) return true;
  if (/abort|timeout|timed out/i.test(err)) return true;
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network|EAI_AGAIN/i.test(err)) return true;
  return false;
}

async function submitWithRetry(args: {
  fileId: string;
  fileName: string;
  pdfBuffer: Buffer;
}): Promise<IngestResult> {
  let last: IngestResult = { ok: false, error: "no attempt" };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await submitPdfToJobPlatform(args);
    if (last.ok) return last;
    if (!isRetryable(last.error) || attempt === MAX_ATTEMPTS) return last;
    const backoff = Math.min(30_000, 2_000 * Math.pow(4, attempt - 1)); // 2s, 8s, 32s→上限30s
    const jitter = Math.floor(Math.random() * 1_000);
    log(`  retry fileId=${args.fileId} attempt=${attempt}/${MAX_ATTEMPTS} in ${backoff + jitter}ms (${last.error})`);
    await sleep(backoff + jitter);
  }
  return last;
}

// ---- daily-ingest（JST 6:30）競合回避 ----
function jstHm(): { h: number; m: number } {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}
async function maybePauseForDailyIngest() {
  let announced = false;
  // JST 06:00–06:45 の間は一時停止（daily-ingest 6:30 と時間帯を被らせない）
  while (true) {
    const { h, m } = jstHm();
    if (!(h === 6 && m < 45)) return;
    if (!announced) {
      log(`⏸ daily-ingest回避で一時停止（JST 06:${String(m).padStart(2, "0")}）— 06:45まで待機`);
      announced = true;
    }
    await sleep(60_000); // 1分ごとに再確認
  }
}

// ---- 対象取得 ----
type Target = {
  id: string;
  candidateId: string;
  fileName: string;
  driveFileId: string;
};

async function fetchTargets(): Promise<Target[]> {
  const rows = await prisma.candidateFile.findMany({
    where: {
      sourceType: null,
      externalJobRef: null,
      category: "BOOKMARK",
      archivedAt: null,
      extractedText: { not: null },
      driveFileId: { not: null },
    },
    select: { id: true, candidateId: true, fileName: true, driveFileId: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidateId,
    fileName: r.fileName,
    driveFileId: r.driveFileId!,
  }));
}

// ---- メイン ----
async function main() {
  const started = Date.now();
  const all = await fetchTargets();
  const handled = loadHandled();
  const pending = all.filter((t) => !handled.has(t.id));
  const cands = new Set(all.map((t) => t.candidateId));

  const estCostAll = (all.length * COST_PER_ITEM_YEN).toFixed(0);
  const estCostPending = (pending.length * COST_PER_ITEM_YEN).toFixed(0);
  const estHours = ((pending.length * SECONDS_PER_ITEM) / WORKERS / 3600).toFixed(1);

  log(`対象(全期間・未紐付け・抽出済・Drive実体あり): ${all.length}件 / 候補者 ${cands.size}名`);
  log(`進捗ファイル済み: ${handled.size}件（ok=${[...handled.values()].filter((s) => s === "ok").length} / failed=${[...handled.values()].filter((s) => s === "failed").length}）`);
  log(`今回の未処理: ${pending.length}件`);
  log(`概算費用: 全体¥${estCostAll} / 未処理分¥${estCostPending}（×¥${COST_PER_ITEM_YEN}/件）`);
  log(`概算所要（未処理分・並列${WORKERS}）: 約${estHours}時間（${SECONDS_PER_ITEM}秒/件÷${WORKERS}）`);

  if (!EXECUTE) {
    log(`DRY-RUN のため投入しません。本実行は --execute を付与。`);
    return;
  }

  const queue = pending.slice(0, LIMIT === Infinity ? pending.length : LIMIT);
  log(`EXECUTE 開始: 今回処理 ${queue.length}件（workers=${WORKERS} / limit=${LIMIT === Infinity ? "なし" : LIMIT}）`);
  log(`進捗ファイル: ${PROGRESS_PATH}`);

  const counters = { ok: 0, failed: 0, deduped: 0 };
  let idx = 0;
  let stopping = false;

  process.on("SIGINT", () => {
    if (stopping) return;
    stopping = true;
    log(`SIGINT 受信 — 新規投入を停止。実行中の分の完了を待って終了します…`);
  });

  // 進捗ログ（60秒ごと）
  const progressTimer = setInterval(() => {
    const done = counters.ok + counters.failed;
    const remain = queue.length - done;
    const elapsedS = (Date.now() - started) / 1000;
    const rate = done > 0 ? done / elapsedS : 0; // 件/秒
    const etaS = rate > 0 ? remain / rate : NaN;
    const eta = Number.isFinite(etaS) ? new Date(Date.now() + etaS * 1000) : null;
    log(
      `進捗: 処理${done}/${queue.length}（ok=${counters.ok} dedup=${counters.deduped} failed=${counters.failed}） 残${remain} ` +
        `経過${Math.round(elapsedS)}s ` +
        `完了予測${eta ? new Date(eta.getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16) + "(JST)" : "—"}`,
    );
  }, 60_000);

  async function worker(wid: number) {
    while (!stopping) {
      const myIdx = idx++;
      if (myIdx >= queue.length) return;
      const t = queue[myIdx];

      await maybePauseForDailyIngest();
      if (stopping) return;

      const tag = `fileId=${t.id} cand=${t.candidateId} file=${t.fileName}`;
      try {
        const { base64 } = await downloadFileFromDrive(t.driveFileId);
        const pdfBuffer = Buffer.from(base64, "base64");
        const res = await submitWithRetry({ fileId: t.id, fileName: t.fileName, pdfBuffer });
        if (res.ok) {
          await prisma.candidateFile.update({
            where: { id: t.id },
            data: { externalJobRef: res.sourceJobId, platformSubmittedAt: new Date() },
          });
          counters.ok++;
          if (res.deduped) counters.deduped++;
          appendProgress({ fileId: t.id, status: "ok", sourceJobId: res.sourceJobId, deduped: res.deduped, ts: ts() });
          log(`  [OK w${wid}] ${tag} → ${res.sourceJobId} (status=${res.status} deduped=${res.deduped})`);
        } else {
          await prisma.candidateFile.update({
            where: { id: t.id },
            data: { platformSubmittedAt: new Date() }, // 試行時刻を刻む
          });
          counters.failed++;
          appendProgress({ fileId: t.id, status: "failed", error: res.error, ts: ts() });
          console.error(`  [NG w${wid}] ${tag}: ${res.error}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          await prisma.candidateFile.update({ where: { id: t.id }, data: { platformSubmittedAt: new Date() } });
        } catch {
          /* noop */
        }
        counters.failed++;
        appendProgress({ fileId: t.id, status: "failed", error: msg, ts: ts() });
        console.error(`  [ERR w${wid}] ${tag}: ${msg}`);
      }
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  clearInterval(progressTimer);

  const elapsedMin = ((Date.now() - started) / 60000).toFixed(1);
  log(
    `完了${stopping ? "(中断)" : ""}: ok=${counters.ok}（うちdedup=${counters.deduped}） failed=${counters.failed} / 経過${elapsedMin}分`,
  );
  log(`失敗分は progress.jsonl に status=failed で記録済み。再実行すると成功分・失敗分ともスキップし残りを処理します。`);
  log(`失敗をやり直す場合は progress.jsonl の該当 failed 行を削除してから再実行してください。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });

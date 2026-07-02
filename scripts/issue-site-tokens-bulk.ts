/**
 * T-128 公開準備②: 求人サイトトークン一括発行スクリプト。
 *
 * 対象（既定）: Interview が1件以上 AND 支援ステータス=ACTIVE(支援中) AND birthday 登録済み。
 *   - 支援終了(ENDED)・支援前(BEFORE)・待機(WAITING)・アーカイブ(ARCHIVED) は対象外（掘り起こしは別途）。
 *   - --include-inactive で「面談登録済み×birthday登録済み」の全ステータスに拡大（今回は使わない想定）。
 *
 * 動作: dry-run 集計をログ出力 → 続けて本実行（issue API を 5並列で呼出）。
 *   - 安全ガード: 対象0人 or 対象>全候補者数 の異常時は本実行せず停止。
 *   - 冪等: issue API は既存トークンなら同一 siteUrl を返す（issued=false）。
 *   - warning（誕生日不一致・期限切れ等）は CSV と最終集計に記録。
 *   - 失敗はスキップして記録（全体は止めない）。
 *
 * 出力: verify/site-token-rollout-YYYYMMDD.csv
 *   列: candidateNumber, result(新規/既存/failed/skip), warning, skipReason
 *
 * 使い方:
 *   KYUUJIN_API_SECRET=... npx tsx scripts/issue-site-tokens-bulk.ts [--include-inactive] [--dry-run]
 */
import pg from "pg";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const INCLUDE_INACTIVE = process.argv.includes("--include-inactive");
const DRY_RUN_ONLY = process.argv.includes("--dry-run");
const CONCURRENCY = 5;

const KYUUJIN_API_URL = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;

type Row = {
  candidateNumber: string;
  birthdayStr: string | null; // YYYY-MM-DD（Postgres TO_CHAR で TZ変換を回避した純粋な日付）
  supportStatus: string;
};

type CsvRow = {
  candidateNumber: string;
  result: "新規" | "既存" | "failed" | "skip";
  warning: string;
  skipReason: string;
};

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function issueToken(
  candidateNumber: string,
  birthDate: string
): Promise<{ issued: boolean; warning: string | null } | { error: string }> {
  try {
    const res = await fetch(`${KYUUJIN_API_URL}/api/external/tokens/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": KYUUJIN_API_SECRET as string,
      },
      body: JSON.stringify({ candidateNumber, birthDate, createdBy: "bulk-rollout" }),
    });
    const raw = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}: ${raw.slice(0, 120)}` };
    const data = JSON.parse(raw) as { issued?: boolean; warning?: string | null };
    return { issued: data.issued ?? false, warning: data.warning ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function runPool<T, R>(items: T[], worker: (item: T, idx: number) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function loop() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, loop));
  return results;
}

async function main() {
  if (!KYUUJIN_API_SECRET && !DRY_RUN_ONLY) {
    console.error("❌ KYUUJIN_API_SECRET が未設定です（本実行には必須）。");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const totalCandidates = Number(
    (await pool.query(`SELECT COUNT(*) as cnt FROM candidates`)).rows[0].cnt
  );

  // 面談登録済み（InterviewRecord 1件以上）の候補者を全件取得。
  const rows: Row[] = (
    await pool.query(
      `SELECT c.candidate_number AS "candidateNumber",
              TO_CHAR(c.birthday, 'YYYY-MM-DD') AS "birthdayStr",
              c.support_status AS "supportStatus"
       FROM candidates c
       WHERE EXISTS (SELECT 1 FROM interview_records ir WHERE ir.candidate_id = c.id)
         AND c.candidate_number IS NOT NULL`
    )
  ).rows;

  const interviewedTotal = rows.length;

  // 分類
  const targets: Row[] = [];
  let excludedNoBirthday = 0;
  let excludedNotActive = 0;
  const notActiveByStatus: Record<string, number> = {};

  for (const r of rows) {
    const isActive = r.supportStatus === "ACTIVE";
    if (!INCLUDE_INACTIVE && !isActive) {
      excludedNotActive++;
      notActiveByStatus[r.supportStatus] = (notActiveByStatus[r.supportStatus] || 0) + 1;
      continue;
    }
    if (!r.birthdayStr) {
      excludedNoBirthday++;
      continue;
    }
    targets.push(r);
  }

  // ---- dry-run 集計 ----
  console.log("========================================");
  console.log("T-128 求人サイトトークン一括発行 — dry-run 集計");
  console.log("========================================");
  console.log(`モード: ${INCLUDE_INACTIVE ? "全ステータス（--include-inactive）" : "支援中(ACTIVE)のみ"}`);
  console.log(`全候補者数: ${totalCandidates}`);
  console.log(`面談登録済み候補者: ${interviewedTotal}`);
  console.log(`  → 対象（発行実行）: ${targets.length}`);
  console.log(`  → 除外(誕生日未登録): ${excludedNoBirthday}`);
  console.log(`  → 除外(支援対象外=非ACTIVE): ${excludedNotActive}`);
  if (excludedNotActive > 0) {
    console.log(`      内訳: ${Object.entries(notActiveByStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  console.log("========================================");

  // ---- 安全ガード ----
  if (targets.length === 0) {
    console.error("⚠️ 対象0人のため本実行を中止します。");
    await pool.end();
    process.exit(1);
  }
  if (targets.length > totalCandidates) {
    console.error(`⚠️ 対象数(${targets.length})が全候補者数(${totalCandidates})を超過。異常のため中止します。`);
    await pool.end();
    process.exit(1);
  }

  const csvRows: CsvRow[] = [];
  // 除外分も CSV に記録（監査用）
  for (const r of rows) {
    const isActive = r.supportStatus === "ACTIVE";
    if (!INCLUDE_INACTIVE && !isActive) {
      csvRows.push({ candidateNumber: r.candidateNumber, result: "skip", warning: "", skipReason: `支援対象外(${r.supportStatus})` });
    } else if (!r.birthdayStr) {
      csvRows.push({ candidateNumber: r.candidateNumber, result: "skip", warning: "", skipReason: "誕生日未登録" });
    }
  }

  if (DRY_RUN_ONLY) {
    console.log("--dry-run 指定のため本実行はスキップしました。");
    await pool.end();
    return;
  }

  // ---- 本実行 ----
  console.log(`本実行開始: ${targets.length}件 を ${CONCURRENCY}並列で発行...`);
  let done = 0;
  const execResults = await runPool(
    targets,
    async (r) => {
      const res = await issueToken(r.candidateNumber, r.birthdayStr as string);
      done++;
      if (done % 50 === 0 || done === targets.length) {
        console.log(`  進捗: ${done}/${targets.length}`);
      }
      return { r, res };
    },
    CONCURRENCY
  );

  let cntNew = 0;
  let cntExisting = 0;
  let cntFailed = 0;
  let cntWarning = 0;

  for (const { r, res } of execResults) {
    if ("error" in res) {
      cntFailed++;
      csvRows.push({ candidateNumber: r.candidateNumber, result: "failed", warning: "", skipReason: res.error });
    } else {
      if (res.issued) cntNew++;
      else cntExisting++;
      if (res.warning) cntWarning++;
      csvRows.push({
        candidateNumber: r.candidateNumber,
        result: res.issued ? "新規" : "既存",
        warning: res.warning || "",
        skipReason: "",
      });
    }
  }

  // ---- CSV 出力 ----
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const csvPath = path.join(verifyDir, `site-token-rollout-${fmtDate(new Date())}.csv`);
  const header = "candidateNumber,result,warning,skipReason\n";
  const body = csvRows
    .map((c) => {
      const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
      return [c.candidateNumber, c.result, esc(c.warning), esc(c.skipReason)].join(",");
    })
    .join("\n");
  fs.writeFileSync(csvPath, header + body + "\n", "utf8");

  // ---- 最終集計 ----
  console.log("========================================");
  console.log("最終集計");
  console.log("========================================");
  console.log(`対象: ${targets.length}`);
  console.log(`  新規発行: ${cntNew}`);
  console.log(`  既存(冪等): ${cntExisting}`);
  console.log(`  warning付き: ${cntWarning}`);
  console.log(`  失敗(failed): ${cntFailed}`);
  console.log(`skip合計: ${excludedNoBirthday + excludedNotActive}`);
  console.log(`  誕生日未登録: ${excludedNoBirthday}`);
  console.log(`  支援対象外(非ACTIVE): ${excludedNotActive}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`CSV総行数: ${csvRows.length}`);
  console.log("========================================");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

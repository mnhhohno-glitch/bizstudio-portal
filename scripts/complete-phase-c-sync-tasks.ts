/**
 * Phase C 一括同期で生成されたタスクを「完了」ステータスに変更するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/complete-phase-c-sync-tasks.ts            # dry-run
 *   npx tsx scripts/complete-phase-c-sync-tasks.ts --dry-run  # dry-run
 *   npx tsx scripts/complete-phase-c-sync-tasks.ts --execute  # 実行
 *
 * idempotent: 既に完了済みは対象外なので何度実行しても安全
 *
 * DB注意: tasks.created_at は timestamp without time zone（JST値格納）。
 * pg driver は Date obj を local timezone 表現で送信するため、
 * Date constructor には JST 時刻を +09:00 で渡す。
 */
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Phase C batch: 22:51:12–22:51:44 JST May 2 + test at 22:39:42 JST
const PHASE_C_START = new Date("2026-05-02T22:38:00+09:00");
const PHASE_C_END   = new Date("2026-05-02T22:53:00+09:00");
const TITLE_PREFIX   = "【マイページ回答】";

async function main() {
  const execute = process.argv.includes("--execute");

  // Pass Date objects (not ISO strings) so pg driver converts to local tz
  const result = await pool.query(
    `SELECT id, title, status, created_at
     FROM tasks
     WHERE created_at >= $1
       AND created_at <= $2
       AND title LIKE $3
       AND status != 'COMPLETED'
     ORDER BY created_at`,
    [PHASE_C_START, PHASE_C_END, `${TITLE_PREFIX}%`]
  );
  const targets = result.rows;

  console.log("=== Phase C sync task cleanup ===");
  console.log(`Time window (JST): 2026-05-02 22:38 ~ 22:53`);
  console.log(`Title pattern: "${TITLE_PREFIX}*"`);
  console.log(`Matching tasks (non-COMPLETED): ${targets.length}\n`);

  for (const t of targets) {
    const jst = new Date(t.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    console.log(`  ${t.status.padEnd(12)} ${jst}  ${t.title}`);
  }

  if (targets.length === 0) {
    console.log("\n対象タスクがありません。");
    await pool.end();
    return;
  }

  const alreadyDone = await pool.query(
    `SELECT count(*) as cnt FROM tasks
     WHERE created_at >= $1 AND created_at <= $2
       AND title LIKE $3 AND status = 'COMPLETED'`,
    [PHASE_C_START, PHASE_C_END, `${TITLE_PREFIX}%`]
  );
  console.log(`\n(既に COMPLETED: ${alreadyDone.rows[0].cnt} 件)`);

  if (!execute) {
    console.log("\n[DRY-RUN] DB更新なし。--execute で実行してください。");
    await pool.end();
    return;
  }

  const ids = targets.map((t: { id: string }) => t.id);
  const updateResult = await pool.query(
    `UPDATE tasks SET status = 'COMPLETED', updated_at = now()
     WHERE id = ANY($1)`,
    [ids]
  );

  console.log(`\n[DONE] ${updateResult.rowCount} 件のタスクを COMPLETED に変更しました。`);
  await pool.end();
}

main().catch((e) => {
  console.error("[ERROR]", e);
  process.exit(1);
});

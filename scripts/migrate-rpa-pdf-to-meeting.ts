/**
 * 既存RPA取り込みPDFの保存先カテゴリを ORIGINAL → MEETING に一括移行
 *
 * 対象: CandidateFile で memo="マイナビRPA自動取り込み" かつ category="ORIGINAL"
 *
 * 使い方:
 *   dry-run:  npx tsx scripts/migrate-rpa-pdf-to-meeting.ts
 *   本番実行: npx tsx scripts/migrate-rpa-pdf-to-meeting.ts --apply
 */

import { Pool } from "pg";
import "dotenv/config";

const MEMO = "マイナビRPA自動取り込み";

async function main() {
  const isApply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // dry-run: 対象件数
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM candidate_files WHERE memo = $1 AND category = 'ORIGINAL'`,
      [MEMO],
    );
    const targetCount = countRes.rows[0].cnt;
    console.log(`[dry-run] 対象件数: ${targetCount}`);

    if (targetCount === 0) {
      console.log("[dry-run] 対象なし（移行済みまたは該当データなし）。終了。");
      return;
    }

    // サンプル5件
    const sampleRes = await pool.query(
      `SELECT cf.id, cf.category, cf.file_name, cf.memo, cf.created_at, c.candidate_number
       FROM candidate_files cf
       JOIN candidates c ON c.id = cf.candidate_id
       WHERE cf.memo = $1 AND cf.category = 'ORIGINAL'
       ORDER BY cf.created_at DESC LIMIT 5`,
      [MEMO],
    );
    console.log("[dry-run] サンプル:");
    for (const r of sampleRes.rows) {
      console.log(`  ${r.candidate_number} | ${r.file_name} | category=${r.category} | memo=${r.memo} | ${r.created_at}`);
    }

    // 安全弁: 対象行が全て条件通りか検証
    const badRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM candidate_files WHERE memo = $1 AND category != 'ORIGINAL'`,
      [MEMO],
    );
    if (badRes.rows[0].cnt > 0) {
      console.log(`[安全弁] memo="${MEMO}" かつ category!="ORIGINAL" が ${badRes.rows[0].cnt} 件あります（既にMEETINGへ移行済みの可能性）。`);
    }

    if (!isApply) {
      console.log("\n--apply を付けて再実行すると本更新を実行します。");
      return;
    }

    // apply
    console.log("\n[apply] UPDATE 実行中...");
    const updateRes = await pool.query(
      `UPDATE candidate_files SET category = 'MEETING', updated_at = NOW() WHERE memo = $1 AND category = 'ORIGINAL'`,
      [MEMO],
    );
    console.log(`[apply] UPDATE完了: ${updateRes.rowCount} 件`);

    // 検証
    const remainRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM candidate_files WHERE memo = $1 AND category = 'ORIGINAL'`,
      [MEMO],
    );
    const meetingRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM candidate_files WHERE memo = $1 AND category = 'MEETING'`,
      [MEMO],
    );
    console.log(`[検証] 残ORIGINAL: ${remainRes.rows[0].cnt} / MEETING: ${meetingRes.rows[0].cnt}`);

    if (remainRes.rows[0].cnt !== 0) {
      console.error("[検証NG] ORIGINAL残件が0ではありません！");
      process.exit(1);
    }
    console.log("[検証OK] 移行完了。");
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

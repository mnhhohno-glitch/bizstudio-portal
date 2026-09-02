/**
 * T-189: 自動配信（origin='auto'）の検証残骸を削除する
 *
 * 背景: 2026-09-02 の受け口・引き当ての検証で、求人サイト側の配信条件が「絞り込みなし」の
 *   ままだった状態で引き当てが走り、意図しない求人が求職者 5008419 のブックマークに
 *   自動配信行として作られた。AI評価も承認もされていない（＝誰の目にも触れていない）行なので
 *   削除する。将幸さん承認済み。
 *
 * 対象（AND。すべて「作られてから何も起きていない」ことの確認）:
 *   origin='auto'
 *   AND 作成日(JST) = TARGET_JST_DATE（既定 2026-09-02）
 *   AND approval_status='PENDING'
 *   AND ai_match_rating IS NULL AND ai_analyzed_at IS NULL
 *   AND introduced_at IS NULL AND last_exported_at IS NULL
 *   AND drive_file_id IS NULL AND archived_at IS NULL
 *
 * 加えて（OR）:
 *   求職者 5999999（大野テスト・検証専用アカウント）の origin='auto' 行は日付・状態を問わず全件。
 *   ※このアカウントは検証にしか使わないため、受け口の再検証で作った行も同じスクリプトで消せる。
 *
 * 安全策:
 *   - dry-run（既定）は一切書き込まない。--execute 指定時のみ削除。
 *   - 削除前に全カラムを CSV（verify/t189-auto-rows-deleted-<timestamp>.csv）へ退避。
 *   - 削除直前に関連レコードを再確認し、1件でもあれば **その行は削除せず報告**する。
 *     例外は --allow-completed-ledger を付けたときの「完了済みの投入台帳」だけ（下記）。
 *       ・本人回答         : candidate_response_submission_items（当該ファイル）
 *                            / candidate_job_responses（kyuujin_job_id 経由）
 *       ・OneDrive同期ログ  : one_drive_sync_logs
 *       ・AI評価の投入台帳  : recommend_analyze_batches.file_ids に含まれる
 *       ・エントリー        : job_entries（candidate_id × external_job_ref）
 *   - 削除は抽出済み ID 限定（unscoped DELETE なし）。
 *   - idempotent: 2回目以降は対象0件で正常終了する。
 *
 * --allow-completed-ledger について:
 *   受け口の検証で作った行は、その場で AI評価バッチへ投入されるため投入台帳に必ず載る。
 *   台帳が **COMPLETED / FAILED / EXPIRED**（＝回収が終わっている）なら履歴レコードに過ぎず、
 *   CandidateFile を消しても回収処理には影響しない（回収は status='SUBMITTED' の行しか読まない。
 *   file_ids は FK ではないので参照が残っても壊れない）。この場合だけブロックを解除する。
 *   **SUBMITTED（回収前）の台帳がある行は、このフラグを付けても削除しない**（回収中の取りこぼし防止）。
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/delete-t189-test-auto-rows.ts             # dry-run
 *   npx tsx --env-file=.env scripts/delete-t189-test-auto-rows.ts --execute   # 実削除
 *   npx tsx --env-file=.env scripts/delete-t189-test-auto-rows.ts --allow-completed-ledger --execute
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "fs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");
// 回収済み（COMPLETED/FAILED/EXPIRED）の投入台帳に載っているだけの行を削除対象に含める。
// SUBMITTED（回収前）の台帳がある行は、このフラグの有無に関わらず削除しない。
const ALLOW_COMPLETED_LEDGER = process.argv.includes("--allow-completed-ledger");

/** 残骸が作られた日（JST）。この日に作られた未着手の自動配信行だけを対象にする。 */
const TARGET_JST_DATE = "2026-09-02";
/** 検証専用アカウント。origin='auto' 行は日付を問わず全件対象。 */
const TEST_CANDIDATE_NUMBERS = ["5999999"];

// JST の1日を UTC 範囲へ（DB の timestamp は UTC 値で入っている）。
function jstDayToUtcRange(jstDate: string): { from: Date; to: Date } {
  const from = new Date(`${jstDate}T00:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

type Row = Record<string, unknown>;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

async function main() {
  const { from, to } = jstDayToUtcRange(TARGET_JST_DATE);
  console.log(
    `[delete-t189-test-auto-rows] mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"} ` +
      `対象日(JST)=${TARGET_JST_DATE} [${from.toISOString()} , ${to.toISOString()}) ` +
      `テストアカウント=${TEST_CANDIDATE_NUMBERS.join(",")}`,
  );

  // 1. 対象抽出（全カラム。CSV退避にそのまま使う）
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT f.*, c.candidate_number
    FROM candidate_files f
    JOIN candidates c ON c.id = f.candidate_id
    WHERE f.origin = 'auto'
      AND (
        (
          f.created_at >= ${from} AND f.created_at < ${to}
          AND f.approval_status = 'PENDING'
          AND f.ai_match_rating IS NULL
          AND f.ai_analyzed_at IS NULL
          AND f.introduced_at IS NULL
          AND f.last_exported_at IS NULL
          AND f.drive_file_id IS NULL
          AND f.archived_at IS NULL
        )
        OR c.candidate_number = ANY(${TEST_CANDIDATE_NUMBERS}::text[])
      )
    ORDER BY c.candidate_number, f.created_at
  `;

  console.log(`[delete-t189-test-auto-rows] 抽出: ${rows.length} 件`);
  if (rows.length === 0) {
    console.log("[delete-t189-test-auto-rows] 対象なし（idempotent）");
    return;
  }

  // 内訳（求職者別）
  const byCand = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.candidate_number);
    byCand.set(k, (byCand.get(k) ?? 0) + 1);
  }
  for (const [num, n] of byCand) console.log(`  求職者 ${num}: ${n} 件`);

  // 一覧（id / 求人番号 / 会社名）
  console.log("--- 対象一覧（id / external_job_ref / file_name） ---");
  for (const r of rows) {
    console.log(`  ${r.id}\t${r.external_job_ref ?? "-"}\t${r.file_name ?? "-"}`);
  }

  // 2. 関連レコードの確認（0 でない行は削除しない）
  const ids = rows.map((r) => String(r.id));
  const candidateIds = [...new Set(rows.map((r) => String(r.candidate_id)))];
  const jobRefs = [...new Set(rows.map((r) => r.external_job_ref).filter(Boolean).map(String))];
  const kyuujinJobIds = [
    ...new Set(rows.map((r) => r.kyuujin_job_id).filter((v) => v !== null && v !== undefined).map(Number)),
  ];

  const blocked = new Map<string, string[]>();
  const block = (fileId: string, reason: string) => {
    const arr = blocked.get(fileId) ?? [];
    arr.push(reason);
    blocked.set(fileId, arr);
  };

  const submissionItems = await prisma.$queryRaw<{ candidate_file_id: string }[]>`
    SELECT candidate_file_id FROM candidate_response_submission_items
    WHERE candidate_file_id = ANY(${ids}::text[])
  `;
  for (const r of submissionItems) block(r.candidate_file_id, "本人回答(submission_item)");

  // OneDrive: 実際にコピーされた（status=SUCCESS もしくは target_item_id が付いている）行だけを
  //   ブロック対象にする。PENDING/SKIPPED/FAILED は OneDrive 側に実体が無く、ログ行自体は
  //   CandidateFile 削除時に onDelete: Cascade で消えるため残骸にならない。
  const syncLogs = await prisma.$queryRaw<{ candidate_file_id: string; status: string; target_item_id: string | null }[]>`
    SELECT candidate_file_id, status::text AS status, target_item_id FROM onedrive_sync_logs
    WHERE candidate_file_id = ANY(${ids}::text[])
  `;
  let notCopiedSyncLogs = 0;
  for (const r of syncLogs) {
    if (r.status === "SUCCESS" || r.target_item_id) {
      block(r.candidate_file_id, `OneDrive同期ログ(${r.status}・コピー済み)`);
    } else {
      notCopiedSyncLogs++;
    }
  }
  if (notCopiedSyncLogs > 0) {
    console.log(
      `[delete-t189-test-auto-rows] OneDrive未コピーの同期ログ ${notCopiedSyncLogs} 件はブロックしない` +
        `（OneDrive側に実体なし・行はCascadeで消える）`,
    );
  }

  // 投入台帳: file_ids は JSON 配列。1行ずつ突き合わせる。
  const batches = await prisma.$queryRaw<{ id: string; batch_id: string; status: string; file_ids: unknown }[]>`
    SELECT id, batch_id, status, file_ids FROM recommend_analyze_batches
    WHERE candidate_id = ANY(${candidateIds}::text[])
  `;
  const idSet = new Set(ids);
  let completedLedgerRefs = 0;
  for (const b of batches) {
    const list = Array.isArray(b.file_ids) ? b.file_ids : [];
    const settled = b.status !== "SUBMITTED"; // COMPLETED / FAILED / EXPIRED = 回収済み（履歴）
    for (const fid of list) {
      if (typeof fid !== "string" || !idSet.has(fid)) continue;
      if (settled && ALLOW_COMPLETED_LEDGER) {
        completedLedgerRefs++;
        continue; // 履歴レコードなのでブロックしない（--allow-completed-ledger 指定時のみ）
      }
      block(fid, `投入台帳(${b.batch_id}/${b.status})`);
    }
  }
  if (completedLedgerRefs > 0) {
    console.log(
      `[delete-t189-test-auto-rows] 回収済み投入台帳の参照 ${completedLedgerRefs} 件は ` +
        `--allow-completed-ledger によりブロックしない（履歴レコードのため）`,
    );
  }

  // エントリー: candidate_id × external_job_ref（サイト経由/ブックマーク由来の紐付けキー）
  if (jobRefs.length > 0) {
    const entries = await prisma.$queryRaw<{ candidate_id: string; external_job_ref: string }[]>`
      SELECT candidate_id, external_job_ref FROM job_entries
      WHERE candidate_id = ANY(${candidateIds}::text[])
        AND external_job_ref = ANY(${jobRefs}::text[])
    `;
    const entryKeys = new Set(entries.map((e) => `${e.candidate_id} ${e.external_job_ref}`));
    for (const r of rows) {
      if (!r.external_job_ref) continue;
      if (entryKeys.has(`${String(r.candidate_id)} ${String(r.external_job_ref)}`)) {
        block(String(r.id), "エントリー(job_entries)");
      }
    }
  }

  // 本人回答（kyuujin_job_id 経由）。自動配信行は通常 null だが念のため確認する。
  if (kyuujinJobIds.length > 0) {
    const cjr = await prisma.$queryRaw<{ candidate_id: string; external_job_id: number }[]>`
      SELECT candidate_id, external_job_id FROM candidate_job_responses
      WHERE candidate_id = ANY(${candidateIds}::text[])
        AND external_job_id = ANY(${kyuujinJobIds}::int[])
    `;
    const cjrKeys = new Set(cjr.map((e) => `${e.candidate_id} ${e.external_job_id}`));
    for (const r of rows) {
      if (r.kyuujin_job_id === null || r.kyuujin_job_id === undefined) continue;
      if (cjrKeys.has(`${String(r.candidate_id)} ${Number(r.kyuujin_job_id)}`)) {
        block(String(r.id), "本人回答(candidate_job_responses)");
      }
    }
  }

  if (blocked.size > 0) {
    console.log(`[delete-t189-test-auto-rows] ⚠ 関連レコードありのため削除しない行: ${blocked.size} 件`);
    for (const [fid, reasons] of blocked) {
      const r = rows.find((x) => String(x.id) === fid);
      console.log(`  ${fid}\t${r?.external_job_ref ?? "-"}\t${reasons.join(" / ")}`);
    }
  } else {
    console.log("[delete-t189-test-auto-rows] 関連レコード: 0 件（全行削除可）");
  }

  const deletable = rows.filter((r) => !blocked.has(String(r.id)));
  console.log(`[delete-t189-test-auto-rows] 削除対象: ${deletable.length} 件`);

  if (!EXECUTE) {
    console.log("[delete-t189-test-auto-rows] DRY-RUN のため終了（--execute で実削除）");
    await reportCounts();
    return;
  }
  if (deletable.length === 0) {
    await reportCounts();
    return;
  }

  // 3. CSV 退避（削除前・全カラム）
  mkdirSync("verify", { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const csvPath = `verify/t189-auto-rows-deleted-${stamp}.csv`;
  writeFileSync(csvPath, toCsv(deletable), "utf8");
  console.log(`[delete-t189-test-auto-rows] CSV退避: ${csvPath}（${deletable.length} 行）`);

  // 4. 削除（抽出済み ID 限定）
  const delIds = deletable.map((r) => String(r.id));
  let deleted = 0;
  const BATCH = 200;
  for (let i = 0; i < delIds.length; i += BATCH) {
    const res = await prisma.candidateFile.deleteMany({ where: { id: { in: delIds.slice(i, i + BATCH) } } });
    deleted += res.count;
  }
  console.log(`[delete-t189-test-auto-rows] 削除完了: ${deleted} 件（対象 ${delIds.length} 件）`);
  if (deleted !== delIds.length) {
    console.warn("[delete-t189-test-auto-rows] ⚠ 削除数と対象数が不一致（並行更新の可能性）");
  }

  await reportCounts();
}

async function reportCounts() {
  const total = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM candidate_files WHERE origin = 'auto'
  `;
  const per = await prisma.$queryRaw<{ candidate_number: string; n: number; pending: number }[]>`
    SELECT c.candidate_number,
           count(*)::int AS n,
           count(*) FILTER (WHERE f.approval_status = 'PENDING')::int AS pending
    FROM candidate_files f JOIN candidates c ON c.id = f.candidate_id
    WHERE f.origin = 'auto'
    GROUP BY 1 ORDER BY 2 DESC
  `;
  console.log(`[delete-t189-test-auto-rows] 現在の origin='auto' 全体: ${total[0]?.n ?? 0} 件`);
  for (const r of per) {
    console.log(`  求職者 ${r.candidate_number}: ${r.n} 件（うち PENDING ${r.pending} 件）`);
  }
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

/**
 * T-190 既存の重複求職者3組の整理
 *
 * 背景: 重複判定の作り直し（981bdc5）より前に作られてしまった重複が本番に残っている。
 *   業務側で「どちらを残すか」の判断が確定したので、その指示どおりに整理する。
 *
 * 対象（この3件以外には一切触らない）:
 *   5008473 藤井 聖也 → アーカイブ（supportStatus = "ARCHIVED"）
 *   5008416 重冨 太志 → アーカイブ（supportStatus = "ARCHIVED"）
 *   5008551 犬飼 智哉 → 完全削除（求職者レコードを DELETE）
 *
 *   残す側（5008470 / 5008449 / 5008550）はこのスクリプトでは読みも書きもしない。
 *
 * 安全策:
 *   - dry-run（既定）は一切書き込まない。--execute 指定時のみ変更。
 *   - 削除対象は information_schema から candidates を参照する外部キーを「全件」列挙し、
 *     その全テーブルの該当行数を数える。1件でも残っていれば削除せず中止する。
 *     （ハードコードした関連テーブル一覧を信用しない。列を足した時に取りこぼさないため）
 *   - 削除は求職者レコード1行のみ。関連行の巻き込み削除は一切しない。
 *   - idempotent: 2回目以降は「対象0件」で正常終了する。
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-candidates-t190.ts            # dry-run
 *   npx tsx scripts/cleanup-duplicate-candidates-t190.ts --execute  # 実行
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");

type Action = "ARCHIVE" | "DELETE";

const TARGETS: { candidateNumber: string; name: string; action: Action }[] = [
  { candidateNumber: "5008473", name: "藤井 聖也", action: "ARCHIVE" },
  { candidateNumber: "5008416", name: "重冨 太志", action: "ARCHIVE" },
  { candidateNumber: "5008551", name: "犬飼 智哉", action: "DELETE" },
];

/** candidates を外部キーで参照している全テーブル・全列を information_schema から列挙する */
async function listReferencingColumns(): Promise<
  { table: string; column: string }[]
> {
  const rows = await prisma.$queryRaw<
    { table_name: string; column_name: string }[]
  >`
    SELECT src.table_name, src.column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS src
      ON tc.constraint_name = src.constraint_name
     AND tc.table_schema = src.table_schema
    JOIN information_schema.constraint_column_usage AS tgt
      ON tc.constraint_name = tgt.constraint_name
     AND tc.table_schema = tgt.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tgt.table_name = 'candidates'
      AND tgt.column_name = 'id'
    ORDER BY src.table_name, src.column_name
  `;
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

function quoteIdent(s: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(s)) throw new Error(`unexpected identifier: ${s}`);
  return `"${s}"`;
}

/** 指定求職者IDを参照している行数を、参照元テーブル・列ごとに数える */
async function countRelatedRows(
  candidateId: string,
  refs: { table: string; column: string }[]
): Promise<{ table: string; column: string; count: number }[]> {
  const out: { table: string; column: string; count: number }[] = [];
  for (const ref of refs) {
    const sql = `SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(
      ref.table
    )} WHERE ${quoteIdent(ref.column)} = $1`;
    const res = await pool.query<{ c: string }>(sql, [candidateId]);
    out.push({ table: ref.table, column: ref.column, count: Number(res.rows[0].c) });
  }
  return out;
}

async function main() {
  console.log(
    `[cleanup-dup-candidates-t190] mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}`
  );

  const refs = await listReferencingColumns();
  console.log(
    `[cleanup-dup-candidates-t190] candidates を参照する外部キー: ${refs.length} 列`
  );

  let archived = 0;
  let deleted = 0;
  let skipped = 0;
  let aborted = 0;

  for (const t of TARGETS) {
    const c = await prisma.candidate.findUnique({
      where: { candidateNumber: t.candidateNumber },
      select: { id: true, name: true, candidateNumber: true, supportStatus: true },
    });

    console.log("");
    console.log("--------------------------------------------------");

    if (!c) {
      console.log(
        `${t.candidateNumber} / ${t.name} / (レコードなし)`
      );
      console.log(`  → 対象外（既に削除済み、または存在しない）`);
      skipped++;
      continue;
    }

    if (c.name !== t.name) {
      console.log(
        `${c.candidateNumber} / ${c.name} / ${c.supportStatus}`
      );
      console.log(
        `  → 中止: 氏名が想定（${t.name}）と一致しない。手動確認が必要`
      );
      aborted++;
      continue;
    }

    const related = await countRelatedRows(c.id, refs);
    const byTable = new Map<string, number>();
    for (const r of related) {
      byTable.set(r.table, (byTable.get(r.table) ?? 0) + r.count);
    }
    const num = (table: string) => byTable.get(table) ?? 0;
    const totalRelated = related.reduce((a, r) => a + r.count, 0);

    console.log(
      `${c.candidateNumber} / ${c.name} / ${c.supportStatus} / ` +
        `応募書類 ${num("candidate_files")}件 / エントリー ${num("job_entries")}件 / ` +
        `面談 ${num("interview_records")}件 / タスク ${num("tasks")}件 / ` +
        `処理ログ ${num("candidate_settings_histories")}件`
    );
    console.log(`  関連行 合計: ${totalRelated}件（全${refs.length}外部キー列を集計）`);
    const nonZero = related.filter((r) => r.count > 0);
    if (nonZero.length > 0) {
      for (const r of nonZero) {
        console.log(`    - ${r.table}.${r.column}: ${r.count}件`);
      }
    }

    if (t.action === "ARCHIVE") {
      if (c.supportStatus === "ARCHIVED") {
        console.log(`  → 対象外（既に ARCHIVED）`);
        skipped++;
        continue;
      }
      console.log(`  → 実行する処理: アーカイブ（${c.supportStatus} → ARCHIVED）`);
      if (EXECUTE) {
        await prisma.candidate.update({
          where: { id: c.id },
          data: { supportStatus: "ARCHIVED" },
        });
        console.log(`     実行しました`);
      }
      archived++;
      continue;
    }

    // DELETE
    if (totalRelated > 0) {
      console.log(
        `  → 中止: 関連レコードが ${totalRelated} 件残っている（0件でなければ削除しない）`
      );
      aborted++;
      continue;
    }
    console.log(`  → 実行する処理: 完全削除（求職者レコード1行のみ）`);
    if (EXECUTE) {
      const res = await prisma.candidate.deleteMany({ where: { id: c.id } });
      console.log(`     実行しました（削除 ${res.count} 行）`);
    }
    deleted++;
  }

  console.log("");
  console.log("--------------------------------------------------");
  console.log(
    `[cleanup-dup-candidates-t190] アーカイブ対象 ${archived}件 / 削除対象 ${deleted}件 / ` +
      `対象外 ${skipped}件 / 中止 ${aborted}件`
  );
  if (!EXECUTE) {
    console.log(`[cleanup-dup-candidates-t190] dry-run のため書き込みはしていません`);
  }
  if (aborted > 0) process.exitCode = 1;
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

export {};

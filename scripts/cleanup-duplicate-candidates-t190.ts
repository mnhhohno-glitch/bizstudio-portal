/**
 * T-190 既存の重複求職者3組の整理
 *
 * 背景: 重複判定の作り直し（981bdc5）より前に作られてしまった重複が本番に残っている。
 *   業務側で「どちらを残すか」の判断が確定したので、その指示どおりに整理する。
 *
 * 対象（この3件以外には一切触らない）:
 *   5008473 藤井 聖也 → アーカイブ（supportStatus = "ARCHIVED"）
 *   5008416 重冨 太志 → アーカイブ（supportStatus = "ARCHIVED"）
 *   5008551 犬飼 智哉 → 応募書類を 5008550 へ付け替えたうえで完全削除
 *
 *   残す側（5008470 / 5008449）はこのスクリプトでは読みも書きもしない。
 *   5008550 は 5008551 の応募書類の付け替え先としてのみ触る（それ以外の列は変更しない）。
 *
 * 犬飼の経緯:
 *   当初「関連レコード0件」の想定だったが、dry-run で7件残っていることが判明した。
 *   内訳は 応募書類PDF 1件（category=MEETING のため応募書類タブに出ておらず0件に見えた）、
 *   処理ログ2件、RPA処理ログ2件、空のAIチャットセッション1件、guide_entries 1件。
 *   さらに残す側の 5008550 は応募書類0件で、PDFを持っているのは消す側だけだった。
 *   そのため業務判断として「PDFを 5008550 へ付け替えてから削除」に変更した。
 *
 * 関連行の扱い（schema 側の onDelete 定義に従う。勝手に消さない）:
 *   candidate_files              … Restrict。付け替える（唯一の実体なので失いたくない）
 *   advisor_chat_sessions        … Restrict。明示削除（メッセージ0件であることを確認してから）
 *   guide_entries                … Restrict。明示削除
 *   candidate_settings_histories … Cascade。求職者削除で一緒に消える
 *   mynavi_rpa_processing_logs   … SetNull。candidate_id が NULL になり行自体は残る
 *                                   （氏名・電話・処理結果は監査ログとして保全される）
 *
 * 安全策:
 *   - dry-run（既定）は一切書き込まない。--execute 指定時のみ変更。
 *   - information_schema から candidates を参照する外部キーを delete_rule 付きで「全件」列挙する。
 *     ハードコードした一覧は信用しない（列を足した時に取りこぼさないため）。
 *   - 求職者を削除する直前に全FK列を数え直し、残っている参照が Cascade / SetNull の
 *     どちらでもない（＝ Restrict で明示処理し漏れている）場合は削除せず中止する。
 *   - 削除は1トランザクション。途中で落ちたら全部戻る。
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

type Target =
  | { candidateNumber: string; name: string; action: "ARCHIVE" }
  | {
      candidateNumber: string;
      name: string;
      action: "DELETE";
      /** 応募書類の付け替え先。氏名まで一致することを実行前に確認する */
      reassignFilesTo: { candidateNumber: string; name: string };
      /** Restrict のため明示削除する参照元テーブル（これ以外が残っていたら中止） */
      deleteRelated: string[];
    };

const TARGETS: Target[] = [
  { candidateNumber: "5008473", name: "藤井 聖也", action: "ARCHIVE" },
  { candidateNumber: "5008416", name: "重冨 太志", action: "ARCHIVE" },
  {
    candidateNumber: "5008551",
    name: "犬飼 智哉",
    action: "DELETE",
    reassignFilesTo: { candidateNumber: "5008550", name: "犬飼 智哉" },
    deleteRelated: ["advisor_chat_sessions", "guide_entries"],
  },
];

type Ref = { table: string; column: string; deleteRule: string };

/** candidates を外部キーで参照している全テーブル・全列を delete_rule 付きで列挙する */
async function listReferencingColumns(): Promise<Ref[]> {
  const rows = await prisma.$queryRaw<
    { table_name: string; column_name: string; delete_rule: string }[]
  >`
    SELECT src.table_name, src.column_name, rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS src
      ON tc.constraint_name = src.constraint_name
     AND tc.table_schema = src.table_schema
    JOIN information_schema.constraint_column_usage AS tgt
      ON tc.constraint_name = tgt.constraint_name
     AND tc.table_schema = tgt.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tgt.table_name = 'candidates'
      AND tgt.column_name = 'id'
    ORDER BY src.table_name, src.column_name
  `;
  return rows.map((r) => ({
    table: r.table_name,
    column: r.column_name,
    deleteRule: r.delete_rule,
  }));
}

function quoteIdent(s: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(s)) throw new Error(`unexpected identifier: ${s}`);
  return `"${s}"`;
}

type RelatedCount = Ref & { count: number };

/** 指定求職者IDを参照している行数を、参照元テーブル・列ごとに数える */
async function countRelatedRows(
  candidateId: string,
  refs: Ref[]
): Promise<RelatedCount[]> {
  const out: RelatedCount[] = [];
  for (const ref of refs) {
    const sql = `SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(
      ref.table
    )} WHERE ${quoteIdent(ref.column)} = $1`;
    const res = await pool.query<{ c: string }>(sql, [candidateId]);
    out.push({ ...ref, count: Number(res.rows[0].c) });
  }
  return out;
}

function summarize(related: RelatedCount[]) {
  const byTable = new Map<string, number>();
  for (const r of related) byTable.set(r.table, (byTable.get(r.table) ?? 0) + r.count);
  return {
    num: (table: string) => byTable.get(table) ?? 0,
    total: related.reduce((a, r) => a + r.count, 0),
    nonZero: related.filter((r) => r.count > 0),
  };
}

function printCandidate(
  c: { candidateNumber: string; name: string; supportStatus: string },
  related: RelatedCount[],
  refCount: number
) {
  const s = summarize(related);
  console.log(
    `${c.candidateNumber} / ${c.name} / ${c.supportStatus} / ` +
      `応募書類 ${s.num("candidate_files")}件 / エントリー ${s.num("job_entries")}件 / ` +
      `面談 ${s.num("interview_records")}件 / タスク ${s.num("tasks")}件 / ` +
      `処理ログ ${s.num("candidate_settings_histories")}件`
  );
  console.log(`  関連行 合計: ${s.total}件（全${refCount}外部キー列を集計）`);
  for (const r of s.nonZero) {
    console.log(`    - ${r.table}.${r.column}: ${r.count}件 [onDelete=${r.deleteRule}]`);
  }
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
      console.log(`${t.candidateNumber} / ${t.name} / (レコードなし)`);
      console.log(`  → 対象外（既に削除済み、または存在しない）`);
      skipped++;
      continue;
    }

    if (c.name !== t.name) {
      console.log(`${c.candidateNumber} / ${c.name} / ${c.supportStatus}`);
      console.log(`  → 中止: 氏名が想定（${t.name}）と一致しない。手動確認が必要`);
      aborted++;
      continue;
    }

    const related = await countRelatedRows(c.id, refs);
    printCandidate(c, related, refs.length);

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

    // ---- DELETE: 応募書類を付け替えてから削除 ----
    const dest = await prisma.candidate.findUnique({
      where: { candidateNumber: t.reassignFilesTo.candidateNumber },
      select: { id: true, name: true, candidateNumber: true },
    });
    if (!dest) {
      console.log(
        `  → 中止: 付け替え先 ${t.reassignFilesTo.candidateNumber} が存在しない`
      );
      aborted++;
      continue;
    }
    if (dest.name !== t.reassignFilesTo.name) {
      console.log(
        `  → 中止: 付け替え先 ${dest.candidateNumber} の氏名が想定（${t.reassignFilesTo.name}）と一致しない（実際: ${dest.name}）`
      );
      aborted++;
      continue;
    }
    if (dest.id === c.id) {
      console.log(`  → 中止: 付け替え先が削除対象と同一`);
      aborted++;
      continue;
    }

    // Restrict で明示削除する対象に、想定外の子レコードがぶら下がっていないか確認する
    const blockers: string[] = [];
    for (const table of t.deleteRelated) {
      if (table === "advisor_chat_sessions") {
        const n = await prisma.advisorChatMessage.count({
          where: { session: { candidateId: c.id } },
        });
        console.log(`  advisor_chat_messages: ${n}件`);
        if (n > 0) blockers.push(`advisor_chat_sessions に紐づくメッセージが ${n} 件ある`);
      }
    }
    if (blockers.length > 0) {
      for (const b of blockers) console.log(`  → 中止: ${b}`);
      aborted++;
      continue;
    }

    const s = summarize(related);
    const fileCount = s.num("candidate_files");
    // 削除の直前に「Restrict なのに明示処理されない参照」が残っていないか総点検する
    const unhandled = s.nonZero.filter(
      (r) =>
        r.deleteRule !== "CASCADE" &&
        r.deleteRule !== "SET NULL" &&
        r.table !== "candidate_files" &&
        !t.deleteRelated.includes(r.table)
    );
    if (unhandled.length > 0) {
      for (const r of unhandled) {
        console.log(
          `  → 中止: ${r.table}.${r.column} に ${r.count}件 残っており、onDelete=${r.deleteRule} で自動処理されない（処理方針が未定義）`
        );
      }
      aborted++;
      continue;
    }

    console.log(`  → 実行する処理:`);
    console.log(
      `     1. candidate_files ${fileCount}件 を ${dest.candidateNumber} ${dest.name} へ付け替え`
    );
    for (const table of t.deleteRelated) {
      console.log(`     2. ${table} ${s.num(table)}件 を削除（onDelete=Restrict のため明示削除）`);
    }
    console.log(
      `     3. 求職者 ${c.candidateNumber} を削除` +
        `（candidate_settings_histories ${s.num("candidate_settings_histories")}件は Cascade で消え、` +
        `mynavi_rpa_processing_logs ${s.num("mynavi_rpa_processing_logs")}件は SetNull で残る）`
    );

    if (EXECUTE) {
      await prisma.$transaction(async (tx) => {
        const moved = await tx.candidateFile.updateMany({
          where: { candidateId: c.id },
          data: { candidateId: dest.id },
        });
        console.log(`     1. 付け替え ${moved.count}件`);
        for (const table of t.deleteRelated) {
          const res = await tx.$executeRawUnsafe(
            `DELETE FROM ${quoteIdent(table)} WHERE "candidate_id" = $1`,
            c.id
          );
          console.log(`     2. ${table} 削除 ${res}件`);
        }
        const del = await tx.candidate.deleteMany({ where: { id: c.id } });
        console.log(`     3. 求職者 削除 ${del.count}行`);
      });
      console.log(`     実行しました`);
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

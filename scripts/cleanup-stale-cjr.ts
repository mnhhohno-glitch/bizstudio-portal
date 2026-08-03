/**
 * 仕分けステータスと食い違って残った CandidateJobResponse（stale CJR）の掃除
 *
 * 背景: 旧 PORTAL_INTENT_MAP は UNANSWERED しか「取り消し（削除）」に割り当てておらず、
 *   「気になる」→「保留(PENDING)」/「対象外(EXCLUDED)」に変更しても CandidateJobResponse の
 *   INTERESTED / WANT_TO_APPLY 行が残っていた。その結果、マイページ回答タスクの全量リストや
 *   ブックマークのフラグ表示が実態とズレる。
 *   PORTAL_INTENT_MAP に PENDING / EXCLUDED → null（削除）を追加したので、
 *   過去に積み上がった残骸をこのスクリプトで掃除する。
 *
 * 判定: 箱A（CandidateFile category=BOOKMARK）の responseStatus を「正」とし、
 *   PORTAL_INTENT_MAP[status] === null（＝取り消し扱い）の求人に CJR 行が残っていれば削除対象。
 *   ★マッピングは response-status/route.ts が使っているのと同一の PORTAL_INTENT_MAP を import して
 *     再利用する（独自マッチングを発明しない）。responseStatus が NULL の行は route と同じく
 *     UNANSWERED とみなす。
 *
 * ★重要な安全条件: responseStatusUpdatedAt が NULL の行は削除しない（既定）。
 *   本番 dry-run で判明したこと: UNANSWERED 判定になる 194 件はすべて responseStatusUpdatedAt が
 *   NULL だった。これは「候補者が未回答に戻した」のではなく、箱A responseStatus カラム導入前
 *   （または一律バックフィル）に作られた未仕分けの行である。CJR 側には旧マイページ webhook で
 *   記録された正当な「気になる／応募したい」が入っているため、消すと本物の回答が失われる。
 *   よって既定では「実際に仕分けが行われた行（responseStatusUpdatedAt IS NOT NULL）」だけを
 *   削除対象とする。これは本改修の意図（保留・対象外にしたのに残る）とも一致する。
 *   --include-unsorted を付けると未仕分け行も対象に含める（要・個別判断）。
 *
 * 対象外（削除しない・報告のみ）:
 *   - 箱Aに対応するブックマーク行が無い CJR（旧マイページ webhook 由来等）。現在の仕分け状態を
 *     観測できないため触らない。
 *   - PORTAL_INTENT_MAP が undefined を返す状態（IN_SELECTION / SELECTION_ENDED）。CA駆動の選考
 *     進行状態であり候補者の意向を否定しないため、route と同じく同期対象外。
 *   - 未仕分け行（responseStatusUpdatedAt IS NULL）。上記のとおり既定では触らない。
 *
 * 安全策:
 *   - dry-run（既定）は一切書き込まない。--execute 指定時のみ削除。
 *   - 削除は抽出済みの ID 限定（unscoped DELETE なし）。
 *   - rollback CSV を verify/ に出力（復元に必要な全カラム）。
 *   - idempotent: 2回目以降は対象0件で正常終了する。
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-cjr.ts                      # dry-run（仕分け済みのみ）
 *   npx tsx scripts/cleanup-stale-cjr.ts --include-unsorted   # dry-run（未仕分けも含める）
 *   npx tsx scripts/cleanup-stale-cjr.ts --execute            # 実削除
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "fs";
import { PORTAL_INTENT_MAP } from "@/lib/constants/response-status";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");
// 未仕分け（responseStatusUpdatedAt IS NULL）の行も削除対象に含めるか。既定は含めない（安全側）。
const INCLUDE_UNSORTED = process.argv.includes("--include-unsorted");

type StaleRow = {
  id: string;
  candidateId: string;
  candidateNumber: string;
  candidateName: string;
  externalJobId: number;
  response: string;
  respondedAt: string;
  createdAt: string;
  updatedAt: string;
  bookmarkStatus: string; // 箱Aの responseStatus（UNANSWERED は NULL 含む）
  bookmarkArchived: boolean;
  bookmarkSorted: boolean; // responseStatusUpdatedAt が入っている＝実際に仕分けが行われた
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log(`[cleanup-stale-cjr] Mode: ${EXECUTE ? "EXECUTE (delete)" : "DRY-RUN"}`);

  const responses = await prisma.candidateJobResponse.findMany({
    select: {
      id: true,
      candidateId: true,
      externalJobId: true,
      response: true,
      respondedAt: true,
      createdAt: true,
      updatedAt: true,
      candidate: { select: { candidateNumber: true, name: true } },
    },
  });
  console.log(`[cleanup-stale-cjr] CandidateJobResponse 総数: ${responses.length} 件`);

  // 箱A（BOOKMARK）を (candidateId, kyuujinJobId) で索引。@@unique により高々1行。
  // アーカイブ行も含めて引く（一意制約がアーカイブを含むため、除外すると取りこぼす）。
  const bookmarks = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", kyuujinJobId: { not: null } },
    select: {
      candidateId: true,
      kyuujinJobId: true,
      responseStatus: true,
      responseStatusUpdatedAt: true,
      archivedAt: true,
    },
  });
  const bmIndex = new Map<string, { status: string; archived: boolean; sorted: boolean }>();
  for (const b of bookmarks) {
    bmIndex.set(`${b.candidateId}:${b.kyuujinJobId}`, {
      // route と同じ規約: responseStatus NULL は UNANSWERED 扱い
      status: b.responseStatus ?? "UNANSWERED",
      archived: b.archivedAt != null,
      // 実際に仕分けが行われたか。NULL は台帳導入前・一律バックフィルの未仕分け行。
      sorted: b.responseStatusUpdatedAt != null,
    });
  }
  console.log(`[cleanup-stale-cjr] 箱A BOOKMARK（kyuujinJobId あり）: ${bookmarks.length} 件`);

  const stale: StaleRow[] = [];
  const unsorted: StaleRow[] = []; // 取り消し扱いだが未仕分け（既定では削除しない）
  let noBookmark = 0;
  let outOfScope = 0; // IN_SELECTION / SELECTION_ENDED（同期対象外）
  let consistent = 0;

  for (const r of responses) {
    const bm = bmIndex.get(`${r.candidateId}:${r.externalJobId}`);
    if (!bm) {
      noBookmark++;
      continue;
    }
    const intent = PORTAL_INTENT_MAP[bm.status];
    if (intent === undefined) {
      outOfScope++;
      continue;
    }
    if (intent !== null) {
      // INTERESTED / APPLY。値が食い違っていても本スクリプトの対象外（削除条件ではない）。
      consistent++;
      continue;
    }
    const row: StaleRow = {
      id: r.id,
      candidateId: r.candidateId,
      candidateNumber: r.candidate?.candidateNumber ?? "",
      candidateName: r.candidate?.name ?? "",
      externalJobId: r.externalJobId,
      response: r.response,
      respondedAt: r.respondedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      bookmarkStatus: bm.status,
      bookmarkArchived: bm.archived,
      bookmarkSorted: bm.sorted,
    };
    // 未仕分け行は既定では削除しない（CJR 側の回答が正の可能性が高いため）。
    if (!bm.sorted && !INCLUDE_UNSORTED) unsorted.push(row);
    else stale.push(row);
  }

  const byStatus: Record<string, number> = {};
  for (const s of stale) byStatus[s.bookmarkStatus] = (byStatus[s.bookmarkStatus] || 0) + 1;
  const byResponse: Record<string, number> = {};
  for (const s of stale) byResponse[s.response] = (byResponse[s.response] || 0) + 1;
  const archivedCount = stale.filter((s) => s.bookmarkArchived).length;
  const staleCandidates = new Set(stale.map((s) => s.candidateId)).size;

  const unsortedByStatus: Record<string, number> = {};
  for (const s of unsorted) unsortedByStatus[s.bookmarkStatus] = (unsortedByStatus[s.bookmarkStatus] || 0) + 1;

  console.log("");
  console.log(`=== 結果（${INCLUDE_UNSORTED ? "未仕分けも含める" : "仕分け済みのみ・既定"}） ===`);
  console.log(`  削除対象 stale CJR        : ${stale.length} 件 / ${staleCandidates} 名`);
  console.log(`  仕分けステータス内訳      : ${JSON.stringify(byStatus)}`);
  console.log(`  回答種別内訳              : ${JSON.stringify(byResponse)}`);
  console.log(`  うちアーカイブ済ブックマーク: ${archivedCount} 件`);
  console.log(`  整合（INTERESTED/APPLY）  : ${consistent} 件（対象外）`);
  console.log(`  選考中/終了（同期対象外）  : ${outOfScope} 件（対象外）`);
  console.log(`  箱Aに対応行なし（触らない）: ${noBookmark} 件（対象外）`);
  if (!INCLUDE_UNSORTED) {
    console.log(
      `  未仕分け（既定で保護）    : ${unsorted.length} 件 ${JSON.stringify(unsortedByStatus)}`
    );
    console.log(
      "    ※ responseStatusUpdatedAt が NULL＝台帳導入前/一律バックフィルの行。CJR 側の回答が正の"
    );
    console.log("       可能性が高いため削除しない。含めるなら --include-unsorted。");
  }

  if (stale.length > 0) {
    const sample = stale.slice(0, 10);
    console.log("  --- サンプル（先頭10件） ---");
    for (const s of sample) {
      console.log(
        `   ${s.candidateName}（${s.candidateNumber}） job=${s.externalJobId} ${s.response} → 箱A=${s.bookmarkStatus}${s.bookmarkArchived ? "/archived" : ""}`
      );
    }

    try {
      mkdirSync("verify", { recursive: true });
    } catch {
      /* 既存なら無視 */
    }
    const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    const csvPath = `verify/cleanup-stale-cjr-${stamp}.csv`;
    const header =
      "id,candidate_id,candidate_number,candidate_name,external_job_id,response,responded_at,created_at,updated_at,bookmark_status,bookmark_archived,bookmark_sorted";
    const lines = [
      header,
      ...stale.map((s) =>
        [
          s.id, s.candidateId, s.candidateNumber, s.candidateName, s.externalJobId,
          s.response, s.respondedAt, s.createdAt, s.updatedAt, s.bookmarkStatus,
          s.bookmarkArchived, s.bookmarkSorted,
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
    console.log(`  rollback CSV: ${csvPath}（${stale.length} 行）`);
  }

  if (!EXECUTE) {
    console.log("");
    console.log("[cleanup-stale-cjr] DRY-RUN のため削除していません。--execute で実削除。");
    return;
  }

  const ids = stale.map((s) => s.id);
  console.log("");
  console.log(`[cleanup-stale-cjr] EXECUTE: ${ids.length} 件を ID 限定で削除します...`);
  let deleted = 0;
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const r = await prisma.candidateJobResponse.deleteMany({ where: { id: { in: ids.slice(i, i + BATCH) } } });
    deleted += r.count;
  }
  console.log(`[cleanup-stale-cjr] 削除完了: ${deleted} 件（対象 ${ids.length} 件）`);
  if (deleted !== ids.length) {
    console.warn("[cleanup-stale-cjr] ⚠ 削除数と対象数が不一致（並行更新の可能性）");
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

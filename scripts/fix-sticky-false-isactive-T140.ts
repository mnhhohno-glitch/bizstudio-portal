/**
 * T-140: sticky false になった job_entries.is_active を正しい値へ修復する一回限りスクリプト。
 *
 * 背景:
 *   従来は各更新経路（一般PATCH / auto-progress / bulk-flags）が is_active を「無効化トリガー該当なら
 *   false」の一方通行でしか扱わず、一度 false になったエントリーが非トリガーな更新（面接日入力など）を
 *   されても false のまま取り残される "sticky false" バグがあった。ロジック側は resolveEntryIsActive()
 *   に統一済み（双方向再計算）だが、既に false のまま残っている既存レコードは手当てが必要。
 *
 * 方針:
 *   is_active=false の全 job_entries を取得し、各レコードの現在フラグで resolveEntryIsActive() を呼ぶ。
 *   （API本体と同一の純関数を import して再利用。判定の二重定義はしない。explicitIsActive は渡さない）
 *   戻り値が true のレコードだけを is_active=true へ戻す。
 *
 * 実行:
 *   # DRY RUN（DB 書き込みなし・既定）
 *   npx tsx scripts/fix-sticky-false-isactive-T140.ts --dry-run
 *
 *   # 本番実行（DB 書き込み）※ 将幸さんの OK 後のみ
 *   npx tsx scripts/fix-sticky-false-isactive-T140.ts --execute
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { resolveEntryIsActive } from "../src/lib/entries/resolveEntryIsActive";

const EXECUTE = process.argv.includes("--execute");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // is_active=false の全エントリーを、判定に必要なフラグ＋本人特定情報つきで取得。
    const inactive = await prisma.jobEntry.findMany({
      where: { isActive: false },
      select: {
        id: true,
        entryFlag: true,
        entryFlagDetail: true,
        companyFlag: true,
        personFlag: true,
        candidate: { select: { candidateNumber: true, name: true } },
      },
    });

    // resolveEntryIsActive が true を返すもの＝本来 active であるべき＝修復対象。
    const targets = inactive.filter((e) =>
      resolveEntryIsActive({
        entryFlag: e.entryFlag,
        entryFlagDetail: e.entryFlagDetail,
        companyFlag: e.companyFlag,
        personFlag: e.personFlag,
      })
    );

    // entry_flag 別内訳。
    const byFlag: Record<string, number> = {};
    for (const e of targets) {
      const k = e.entryFlag ?? "(null)";
      byFlag[k] = (byFlag[k] ?? 0) + 1;
    }

    const kyuujinShoukaiCount = targets.filter((e) => e.entryFlag === "求人紹介").length;
    const naraIncluded = targets.some((e) => e.candidate?.candidateNumber === "5007959");

    console.log("========== T-140 sticky-false is_active 修復 ==========");
    console.log(`モード: ${EXECUTE ? "EXECUTE（本番書き込み）" : "DRY RUN（書き込みなし）"}`);
    console.log(`is_active=false の総数: ${inactive.length}`);
    console.log(`修復対象（true へ戻すべき）件数: ${targets.length}`);
    console.log(`entry_flag 別内訳: ${JSON.stringify(byFlag)}`);
    console.log(`求人紹介 段階の対象件数: ${kyuujinShoukaiCount}（0 であるべき）`);
    console.log(`奈良さん(5007959) が対象に含まれる: ${naraIncluded}`);
    console.log("--- 対象一覧 (id / candidateNumber / name / entry_flag / entry_flag_detail / person_flag / company_flag) ---");
    for (const e of targets) {
      console.log(
        [
          e.id,
          e.candidate?.candidateNumber ?? "",
          e.candidate?.name ?? "",
          e.entryFlag ?? "",
          e.entryFlagDetail ?? "",
          e.personFlag ?? "",
          e.companyFlag ?? "",
        ].join(" | ")
      );
    }

    // ローカル保存用の機械可読ブロック（ロールバックCSV化に使う）。
    console.log("---T140_TARGETS_JSON_BEGIN---");
    console.log(
      JSON.stringify(
        targets.map((e) => ({
          id: e.id,
          candidateNumber: e.candidate?.candidateNumber ?? null,
          entryFlag: e.entryFlag,
          entryFlagDetail: e.entryFlagDetail,
          personFlag: e.personFlag,
          companyFlag: e.companyFlag,
          oldIsActive: false,
        }))
      )
    );
    console.log("---T140_TARGETS_JSON_END---");

    // 求人紹介が混入していたら判定が誤っている。書き込み前に中断。
    if (kyuujinShoukaiCount > 0) {
      console.error("!! 求人紹介 段階が対象に含まれています。判定が誤っているため中断します。");
      process.exitCode = 2;
      return;
    }

    if (!EXECUTE) {
      console.log(">> DRY RUN 完了（DB は変更していません）");
      return;
    }

    // === 本番 UPDATE ===
    const ids = targets.map((e) => e.id);
    const result = await prisma.jobEntry.updateMany({
      where: { id: { in: ids }, isActive: false },
      data: { isActive: true },
    });
    console.log(`>> UPDATE 実行完了: ${result.count} 件を is_active=true に更新`);
    console.log(`   （対象 ${targets.length} 件 と一致すべき: ${result.count === targets.length ? "OK" : "NG"}）`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

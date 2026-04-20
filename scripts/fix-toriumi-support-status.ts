import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_CANDIDATE_NUMBER = "5004276";

const isExecute = process.argv.includes("--execute");
const isRollback = process.argv.includes("--rollback");

async function main() {
  const mode = isRollback ? "ROLLBACK" : isExecute ? "EXECUTE" : "DRY RUN";
  console.log("========================================");
  console.log(`鳥海慶次郎さん supportStatus 修正 (${mode})`);
  console.log("========================================\n");

  const candidate = await prisma.candidate.findFirst({
    where: { candidateNumber: TARGET_CANDIDATE_NUMBER },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      supportStatus: true,
      supportEndReason: true,
      supportEndDate: true,
      supportEndNote: true,
      supportEndComment: true,
    },
  });

  if (!candidate) {
    console.error(`✗ 候補者が見つかりません: candidateNumber=${TARGET_CANDIDATE_NUMBER}`);
    process.exit(1);
  }

  console.log("✓ 候補者取得成功:");
  console.log(`  id: ${candidate.id}`);
  console.log(`  candidateNumber: ${candidate.candidateNumber}`);
  console.log(`  name: ${candidate.name}`);
  console.log(`  supportStatus: ${candidate.supportStatus}`);
  console.log(`  supportEndReason: ${candidate.supportEndReason ?? "null"}`);
  console.log(`  supportEndDate: ${candidate.supportEndDate?.toISOString() ?? "null"}`);
  console.log(`  supportEndNote: ${candidate.supportEndNote ?? "null"}`);
  console.log(`  supportEndComment: ${candidate.supportEndComment ?? "null"}\n`);

  if (isRollback) {
    if (candidate.supportStatus === "ENDED") {
      console.log("既に ENDED です。ロールバック不要（または別途対応）。");
      return;
    }
    console.log("以下の UPDATE を実行します:");
    console.log(`  UPDATE candidates SET support_status = 'ENDED', support_end_reason = 'REJECTED_ALL' WHERE candidate_number = '${TARGET_CANDIDATE_NUMBER}'\n`);

    if (!isExecute) {
      console.log("DRY RUN モードなので実行しません。");
      console.log("実行するには --rollback --execute を付けてください。");
      return;
    }

    const updated = await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        supportStatus: "ENDED",
        supportEndReason: "REJECTED_ALL",
        supportEndDate: new Date(),
      },
      select: { id: true, name: true, supportStatus: true, supportEndReason: true },
    });
    console.log("✓ ロールバック完了");
    console.log(`  supportStatus: ${updated.supportStatus}`);
    console.log(`  supportEndReason: ${updated.supportEndReason}`);
    return;
  }

  // 通常モード: ENDED → ACTIVE に戻す
  if (candidate.supportStatus === "ACTIVE") {
    console.log("✓ 既に ACTIVE です。修正不要。");
    return;
  }

  if (candidate.supportStatus !== "ENDED") {
    console.log(`⚠ supportStatus が想定外の値です: ${candidate.supportStatus}`);
    console.log("ENDED 以外からの変更は安全のため中断します。");
    process.exit(1);
  }

  console.log("以下の UPDATE を実行します:");
  console.log(`  UPDATE candidates SET`);
  console.log(`    support_status = 'ACTIVE',`);
  console.log(`    support_end_reason = NULL,`);
  console.log(`    support_end_date = NULL,`);
  console.log(`    support_end_note = NULL`);
  console.log(`  WHERE candidate_number = '${TARGET_CANDIDATE_NUMBER}'\n`);

  if (!isExecute) {
    console.log("DRY RUN モードなので実行しません。");
    console.log("実行するには --execute フラグを付けてください。");
    return;
  }

  console.log("UPDATE 実行中...");
  const updated = await prisma.candidate.update({
    where: { id: candidate.id },
    data: {
      supportStatus: "ACTIVE",
      supportEndReason: null,
      supportEndDate: null,
      supportEndNote: null,
    },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      supportStatus: true,
      supportEndReason: true,
      supportEndDate: true,
      supportEndNote: true,
    },
  });
  console.log("✓ 更新完了\n");
  console.log("更新後のレコード:");
  console.log(`  id: ${updated.id}`);
  console.log(`  candidateNumber: ${updated.candidateNumber}`);
  console.log(`  name: ${updated.name}`);
  console.log(`  supportStatus: ${updated.supportStatus}`);
  console.log(`  supportEndReason: ${updated.supportEndReason ?? "null"}`);
  console.log(`  supportEndDate: ${updated.supportEndDate ?? "null"}`);
  console.log(`  supportEndNote: ${updated.supportEndNote ?? "null"}\n`);
  console.log("動作確認方法:");
  console.log("1. 求職者管理画面を開く");
  console.log("2. 「支援中」タブに鳥海慶次郎さんが表示されること");
  console.log("3. 「支援終了」タブから消えていること");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

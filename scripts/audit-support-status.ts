import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const AUTO_REASONS = [
  "HIRED",
  "OFFER_DECLINED_OTHER",
  "OFFER_DECLINED_SELF",
  "WITHDREW_DURING_SELECTION",
  "REJECTED_ALL",
];

async function main() {
  console.log("========================================");
  console.log("supportStatus 全件監査（読み取り専用）");
  console.log("========================================\n");

  const candidates = await prisma.candidate.findMany({
    where: { supportStatus: "ENDED" },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      supportStatus: true,
      supportEndReason: true,
      supportEndDate: true,
      supportEndNote: true,
      employee: { select: { name: true } },
    },
    orderBy: { supportEndDate: { sort: "desc", nulls: "last" } },
  });

  console.log(`支援終了（ENDED）候補者: ${candidates.length} 件\n`);

  const autoEnded = candidates.filter(
    (c) => c.supportEndReason && AUTO_REASONS.includes(c.supportEndReason)
  );

  const noReason = candidates.filter((c) => !c.supportEndReason);

  console.log(`--- 自動終了の可能性あり (${autoEnded.length} 件) ---`);
  console.log("※ checkAutoSupportEnd により自動設定された可能性が高い候補者\n");

  if (autoEnded.length === 0) {
    console.log("  該当なし\n");
  } else {
    console.log(
      padR("候補者番号", 12) +
      padR("氏名", 16) +
      padR("終了理由", 28) +
      padR("終了日", 14) +
      "担当CA"
    );
    console.log("-".repeat(90));
    for (const c of autoEnded) {
      console.log(
        padR(c.candidateNumber, 12) +
        padR(c.name, 16) +
        padR(reasonLabel(c.supportEndReason), 28) +
        padR(c.supportEndDate ? c.supportEndDate.toISOString().slice(0, 10) : "-", 14) +
        (c.employee?.name || "-")
      );
    }
    console.log();
  }

  console.log(`--- 終了理由なし (${noReason.length} 件) ---`);
  console.log("※ supportEndReason が null の ENDED 候補者\n");

  if (noReason.length === 0) {
    console.log("  該当なし\n");
  } else {
    console.log(
      padR("候補者番号", 12) +
      padR("氏名", 16) +
      padR("終了日", 14) +
      "担当CA"
    );
    console.log("-".repeat(60));
    for (const c of noReason) {
      console.log(
        padR(c.candidateNumber, 12) +
        padR(c.name, 16) +
        padR(c.supportEndDate ? c.supportEndDate.toISOString().slice(0, 10) : "-", 14) +
        (c.employee?.name || "-")
      );
    }
    console.log();
  }

  const manual = candidates.filter(
    (c) => c.supportEndReason && !AUTO_REASONS.includes(c.supportEndReason)
  );
  console.log(`--- 手動終了 (${manual.length} 件) ---`);
  console.log("※ 手動で支援終了が設定された候補者（問題なし）\n");

  if (manual.length > 0) {
    console.log(
      padR("候補者番号", 12) +
      padR("氏名", 16) +
      padR("終了理由", 28) +
      padR("終了日", 14) +
      "担当CA"
    );
    console.log("-".repeat(90));
    for (const c of manual) {
      console.log(
        padR(c.candidateNumber, 12) +
        padR(c.name, 16) +
        padR(reasonLabel(c.supportEndReason), 28) +
        padR(c.supportEndDate ? c.supportEndDate.toISOString().slice(0, 10) : "-", 14) +
        (c.employee?.name || "-")
      );
    }
    console.log();
  }

  console.log("========================================");
  console.log("サマリー:");
  console.log(`  ENDED 全体: ${candidates.length} 件`);
  console.log(`  自動終了の可能性: ${autoEnded.length} 件 ← 要確認`);
  console.log(`  終了理由なし: ${noReason.length} 件 ← 要確認`);
  console.log(`  手動終了: ${manual.length} 件 (問題なし)`);
  console.log("========================================");
  console.log("\n※ このスクリプトは読み取り専用です。データの変更は行いません。");
  console.log("※ 自動終了の可能性がある候補者は、将幸さんの個別判断で ACTIVE に戻すか決定してください。");
}

function padR(str: string, len: number): string {
  const s = str || "";
  const charLen = [...s].length;
  return s + " ".repeat(Math.max(0, len - charLen));
}

function reasonLabel(code: string | null): string {
  if (!code) return "-";
  const map: Record<string, string> = {
    HIRED: "入社決定(auto)",
    OFFER_DECLINED_OTHER: "内定辞退_他社決(auto)",
    OFFER_DECLINED_SELF: "内定辞退_自社他(auto)",
    WITHDREW_DURING_SELECTION: "選考中辞退(auto)",
    REJECTED_ALL: "選考落ち(auto)",
    OTHER_COMPANY_BEFORE_ENTRY: "他社決定(エントリー前)",
    ACTIVITY_STOPPED: "転職活動中止",
    NO_MATCHING_JOBS: "希望条件不一致",
    NO_CONTACT: "連絡不通",
    NOT_ELIGIBLE: "紹介対象外",
    NO_CONTACT_AFTER_APPLICATION: "応募後音信不通",
    MEETING_SETUP_DECLINED: "面談設定辞退",
    NO_CONTACT_AFTER_MEETING: "面談後連絡不通",
    OTHER: "その他",
  };
  return map[code] || code;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

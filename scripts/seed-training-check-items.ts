// 研修振り返り: 理解度チェック項目（Day 1）の初期投入
// dayLabel + label をキーに findFirst → update/create するため何度実行しても安全（idempotent）。
// 実行: railway ssh --service bizstudio-portal 経由で `npx tsx scripts/seed-training-check-items.ts`
// （railway run はローカルの空DBに繋がるため使わない）
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type ItemDef = {
  dayLabel: string;
  label: string;
  sortOrder: number;
};

const ITEMS: ItemDef[] = [
  { dayLabel: "Day 1", label: "転職活動の全体フローと用語", sortOrder: 10 },
  { dayLabel: "Day 1", label: "人材紹介の仕組み（誰がお金を払うか・CAとRA）", sortOrder: 20 },
  { dayLabel: "Day 1", label: "求人票の見る順番（募集条件 → 仕事内容）", sortOrder: 30 },
  { dayLabel: "Day 1", label: "必須条件と歓迎要件の違い", sortOrder: 40 },
  { dayLabel: "Day 1", label: "チャレンジ応募の線引き", sortOrder: 50 },
  { dayLabel: "Day 1", label: "事業会社と特殊法人の区別", sortOrder: 60 },
  { dayLabel: "Day 1", label: "未経験転職の書類通過率の相場感", sortOrder: 70 },
];

async function main() {
  for (const def of ITEMS) {
    const existing = await prisma.trainingCheckItem.findFirst({
      where: { dayLabel: def.dayLabel, label: def.label },
    });

    if (existing) {
      const updated = await prisma.trainingCheckItem.update({
        where: { id: existing.id },
        data: { sortOrder: def.sortOrder, isActive: true },
      });
      console.log(`  更新: [${updated.dayLabel}] ${updated.label} (id=${updated.id})`);
    } else {
      const created = await prisma.trainingCheckItem.create({
        data: {
          dayLabel: def.dayLabel,
          label: def.label,
          sortOrder: def.sortOrder,
          isActive: true,
        },
      });
      console.log(`  作成: [${created.dayLabel}] ${created.label} (id=${created.id})`);
    }
  }

  console.log("\n完了");
}

main()
  .catch((e) => {
    console.error("エラー:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

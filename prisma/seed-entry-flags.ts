import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type FlagRow = { flagType: string; parentFlag?: string; value: string; sortOrder: number };

async function main() {
  const flags: FlagRow[] = [];

  // Entry flags (main)
  const entryFlags = ["求人紹介", "応募", "エントリー", "書類選考", "面接", "内定", "入社済"];
  entryFlags.forEach((v, i) => flags.push({ flagType: "entry", value: v, sortOrder: i + 1 }));

  // Entry flag details
  const details: Record<string, string[]> = {
    "求人紹介": ["検討中", "本人辞退"],
    "応募": ["書類確認中", "選考落ち"],
    "エントリー": ["本人辞退", "追加情報取得中", "BS作成中", "作成完了送付前", "送付済本人確認", "本人確認済提出", "追加情報依頼前", "写真取得中", "クローズ"],
    "書類選考": ["選考中", "本人辞退", "選考落ち"],
    "面接": ["一次日程調整中", "一次面接実施前", "一次面接選考中", "二次日程調整中", "二次面接実施前", "二次面接選考中", "最終日程調整中", "最終面接実施前", "最終面接選考中", "本人辞退", "選考落ち", "適性検査受講中", "適性検査受講済", "本人所感回収中", "所感回収済(提出)", "選考中(所感提出)"],
    "内定": ["検討中", "承諾", "本人辞退_他社決", "本人辞退_自社他", "オファー面談日"],
  };
  for (const [parent, values] of Object.entries(details)) {
    values.forEach((v, i) => flags.push({ flagType: "entry_detail", parentFlag: parent, value: v, sortOrder: i + 1 }));
  }

  // Person flags
  const personFlags = [
    "辞退受付済", "受講完了未確認", "受講完了確認済", "見送り通知未送信", "見送り通知送信済",
    "選考通過連絡前", "日程回収中", "日程回収済", "日程通知前", "日程通知済",
    "本人所感回収中", "本人所感回収済",
    "内定通知前", "内定通知済", "入社案内通知前", "入社案内通知済", "入社済",
  ];
  personFlags.forEach((v, i) => flags.push({ flagType: "person", value: v, sortOrder: i + 1 }));

  // Company flags
  const companyFlags = [
    "受講完了報告前", "受講完了報告済", "希望日提出前", "希望日提出済",
    "日程確定未返信", "日程確定返信済", "所感報告前", "所感報告済",
    "承諾返答前", "承諾返答済",
    "入社報告済", "辞退報告前", "辞退報告済",
  ];
  companyFlags.forEach((v, i) => flags.push({ flagType: "company", value: v, sortOrder: i + 1 }));

  // Clear existing and insert
  await prisma.entryFlagMaster.deleteMany();
  for (const f of flags) {
    await prisma.entryFlagMaster.create({
      data: {
        flagType: f.flagType,
        parentFlag: f.parentFlag || null,
        value: f.value,
        sortOrder: f.sortOrder,
      },
    });
  }

  console.log(`Seeded ${flags.length} entry flags`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

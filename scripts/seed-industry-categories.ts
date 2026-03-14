import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type MinorDef = string;
type MiddleDef = { name: string; minors: MinorDef[] };
type MajorDef = { name: string; middles: MiddleDef[] };

const DATA: MajorDef[] = [
  {
    name: "IT・通信・インターネット",
    middles: [
      {
        name: "IT・通信・インターネット",
        minors: ["ソフトウェア・情報処理", "インターネット関連", "ゲーム関連", "通信関連"],
      },
    ],
  },
  {
    name: "メーカー",
    middles: [
      {
        name: "機械・電気・電子",
        minors: [
          "総合電機",
          "コンピューター機器",
          "家電・AV機器",
          "ゲーム・アミューズメント製品",
          "精密機器",
          "通信機器",
          "半導体・電子・電気機器",
          "医療用機器・医療関連",
          "輸送用機器（自動車含む）",
          "重電・産業用電気機器",
          "プラント・エンジニアリング",
          "その他電気・電子関連",
        ],
      },
      {
        name: "素材",
        minors: [
          "鉱業・金属製品・鉄鋼",
          "非鉄金属",
          "ガラス・化学・石油",
          "紙・パルプ",
          "繊維",
          "窯業・セラミック",
          "ゴム",
          "セメント",
        ],
      },
      {
        name: "住宅関連",
        minors: ["住宅・建材・エクステリア", "インテリア・住宅関連"],
      },
      {
        name: "生活関連",
        minors: [
          "生活関連",
          "食品",
          "化粧品・医薬品",
          "日用品・雑貨",
          "玩具",
          "繊維・アパレル",
          "スポーツ・レジャー用品（メーカー）",
          "文具・事務機器関連",
          "宝飾品・貴金属",
          "その他メーカー",
        ],
      },
    ],
  },
  {
    name: "商社",
    middles: [
      {
        name: "商社",
        minors: ["総合商社", "専門商社"],
      },
    ],
  },
  {
    name: "サービス・レジャー",
    middles: [
      {
        name: "サービス",
        minors: [
          "人材派遣・人材紹介",
          "アウトソーシング",
          "教育",
          "医療・福祉・介護サービス",
          "冠婚葬祭",
          "セキュリティ",
          "ビル管理・メンテナンス",
          "エステティック・美容・理容",
          "フィットネスクラブ",
          "サービス（その他）",
        ],
      },
      {
        name: "レジャー",
        minors: ["レジャーサービス・アミューズメント", "ホテル・旅館", "旅行・観光"],
      },
    ],
  },
  {
    name: "流通・小売・フード",
    middles: [
      {
        name: "流通・小売",
        minors: [
          "百貨店",
          "流通・チェーンストア",
          "コンビニエンスストア",
          "ドラッグストア・調剤薬局",
          "ホームセンター",
          "専門店（総合）",
          "専門店（食品関連）",
          "専門店（自動車関連）",
          "専門店（カメラ・OA関連）",
          "専門店（電気機器関連）",
          "専門店（書籍・音楽関連）",
          "専門店（メガネ・貴金属）",
          "専門店（ファッション・服飾関連）",
          "専門店（スポーツ用品）",
          "専門店（インテリア関連）",
          "専門店（その他小売）",
          "通信販売・ネット販売",
        ],
      },
      {
        name: "フード",
        minors: [
          "フードビジネス（総合）",
          "フードビジネス（洋食）",
          "フードビジネス（ファストフード）",
          "フードビジネス（アジア系）",
          "フードビジネス（和食）",
        ],
      },
    ],
  },
  {
    name: "マスコミ・広告・デザイン",
    middles: [
      {
        name: "マスコミ・広告・デザイン",
        minors: [
          "放送・映像・音響",
          "新聞・出版・印刷",
          "広告",
          "ディスプレイ・空間デザイン・イベント",
          "アート・芸能関連",
        ],
      },
    ],
  },
  {
    name: "金融・保険",
    middles: [
      {
        name: "金融・保険",
        minors: [
          "金融総合グループ",
          "外資系金融",
          "政府系・系統金融機関",
          "銀行",
          "外資系銀行",
          "信用組合・信用金庫・労働金庫",
          "信託銀行",
          "投資信託委託・投資顧問",
          "証券・投資銀行",
          "商品取引",
          "ベンチャーキャピタル",
          "事業者金融・消費者金融",
          "クレジット・信販",
          "リース・レンタル",
          "生命保険・損害保険",
          "共済",
          "その他金融",
        ],
      },
    ],
  },
  {
    name: "コンサルティング",
    middles: [
      {
        name: "コンサルティング",
        minors: [
          "シンクタンク・マーケティング・調査",
          "専門コンサルタント",
          "個人事務所（士業）",
        ],
      },
    ],
  },
  {
    name: "不動産・建設・設備",
    middles: [
      {
        name: "不動産・建設・設備",
        minors: [
          "建設コンサルタント",
          "建設・土木",
          "設計",
          "設備工事",
          "リフォーム・内装工事",
          "不動産",
        ],
      },
    ],
  },
  {
    name: "運輸・交通・物流・倉庫",
    middles: [
      {
        name: "運輸・交通・物流・倉庫",
        minors: ["海運・鉄道・空輸・陸運", "物流・倉庫"],
      },
    ],
  },
  {
    name: "環境・エネルギー",
    middles: [
      {
        name: "環境・エネルギー",
        minors: ["環境・リサイクル", "環境関連設備", "電力・ガス・エネルギー"],
      },
    ],
  },
  {
    name: "公的機関・その他",
    middles: [
      {
        name: "公的機関",
        minors: ["警察・消防・自衛隊", "官公庁", "公益・特殊・独立行政法人"],
      },
      {
        name: "その他",
        minors: ["生活協同組合", "農業協同組合（JA金融機関含む）", "農林・水産"],
      },
    ],
  },
];

async function main() {
  console.log("業種カテゴリのシードを開始します...");

  for (let majorIdx = 0; majorIdx < DATA.length; majorIdx++) {
    const majorDef = DATA[majorIdx];
    const major = await prisma.industryCategoryMajor.upsert({
      where: { name: majorDef.name },
      update: { sortOrder: majorIdx + 1 },
      create: { name: majorDef.name, sortOrder: majorIdx + 1 },
    });
    console.log(`大分類: ${major.name} (sortOrder: ${majorIdx + 1})`);

    for (let middleIdx = 0; middleIdx < majorDef.middles.length; middleIdx++) {
      const middleDef = majorDef.middles[middleIdx];

      // Check if middle already exists under this major
      let middle = await prisma.industryCategoryMiddle.findFirst({
        where: { name: middleDef.name, majorId: major.id },
      });

      if (middle) {
        middle = await prisma.industryCategoryMiddle.update({
          where: { id: middle.id },
          data: { sortOrder: middleIdx + 1 },
        });
      } else {
        middle = await prisma.industryCategoryMiddle.create({
          data: {
            name: middleDef.name,
            majorId: major.id,
            sortOrder: middleIdx + 1,
          },
        });
      }
      console.log(`  中分類: ${middle.name} (sortOrder: ${middleIdx + 1})`);

      for (let minorIdx = 0; minorIdx < middleDef.minors.length; minorIdx++) {
        const minorName = middleDef.minors[minorIdx];

        const existingMinor = await prisma.industryCategoryMinor.findFirst({
          where: { name: minorName, middleId: middle.id },
        });

        if (existingMinor) {
          await prisma.industryCategoryMinor.update({
            where: { id: existingMinor.id },
            data: { sortOrder: minorIdx + 1 },
          });
        } else {
          await prisma.industryCategoryMinor.create({
            data: {
              name: minorName,
              middleId: middle.id,
              sortOrder: minorIdx + 1,
            },
          });
        }
        console.log(`    小分類: ${minorName} (sortOrder: ${minorIdx + 1})`);
      }
    }
  }

  console.log("業種カテゴリのシードが完了しました。");
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

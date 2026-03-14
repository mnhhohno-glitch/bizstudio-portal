import { PrismaClient, TaskFieldType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type FieldDef = {
  sortOrder: number;
  label: string;
  fieldType: TaskFieldType;
  isRequired: boolean;
  options?: string[];
};

type CategoryDef = {
  name: string;
  description: string;
  fields: FieldDef[];
};

const CATEGORIES: CategoryDef[] = [
  {
    name: "面談不参加共有",
    description: "面談に参加しなかった求職者の情報を共有する",
    fields: [
      { sortOrder: 1, label: "面談日", fieldType: "DATE", isRequired: true },
      {
        sortOrder: 2, label: "対応", fieldType: "RADIO", isRequired: true,
        options: [
          "通常フロー（追いかけて返信があれば設定）",
          "形式的に追いかけるが返信がきても先々の日程で設定",
          "追いかけ不要",
        ],
      },
    ],
  },
  {
    name: "内定承諾報告",
    description: "内定を承諾した求職者の報告",
    fields: [
      { sortOrder: 1, label: "対象者フルネーム", fieldType: "TEXT", isRequired: true },
      { sortOrder: 2, label: "企業名", fieldType: "TEXT", isRequired: true },
      { sortOrder: 3, label: "理論年収", fieldType: "TEXT", isRequired: true },
      { sortOrder: 4, label: "紹介手数料（税抜き）", fieldType: "TEXT", isRequired: true },
      { sortOrder: 5, label: "内定承諾日", fieldType: "DATE", isRequired: true },
      { sortOrder: 6, label: "入社日", fieldType: "DATE", isRequired: true },
      { sortOrder: 7, label: "内定した職種", fieldType: "TEXT", isRequired: true },
      { sortOrder: 8, label: "内定した業種", fieldType: "TEXT", isRequired: true },
      { sortOrder: 9, label: "内定した勤務地（都道府県）", fieldType: "TEXT", isRequired: true },
      { sortOrder: 10, label: "雇用形態", fieldType: "TEXT", isRequired: true },
      { sortOrder: 11, label: "備考", fieldType: "TEXTAREA", isRequired: false },
    ],
  },
  {
    name: "入社報告",
    description: "求職者の入社確認報告",
    fields: [
      { sortOrder: 1, label: "入社日", fieldType: "DATE", isRequired: true },
      { sortOrder: 2, label: "企業名", fieldType: "TEXT", isRequired: true },
      {
        sortOrder: 3, label: "求人DB", fieldType: "RADIO", isRequired: true,
        options: ["circus", "Zキャリア", "クラウドエージェント", "MJS", "HITO-Link", "自社求人"],
      },
      { sortOrder: 4, label: "変更内容", fieldType: "TEXTAREA", isRequired: false },
    ],
  },
  {
    name: "求職者紹介のFM登録依頼",
    description: "求職者からの紹介者をファイルメーカーに登録する依頼",
    fields: [
      { sortOrder: 1, label: "フルネーム", fieldType: "TEXT", isRequired: true },
      { sortOrder: 2, label: "ふりがな", fieldType: "TEXT", isRequired: true },
      { sortOrder: 3, label: "生年月日", fieldType: "DATE", isRequired: false },
      {
        sortOrder: 4, label: "性別", fieldType: "RADIO", isRequired: false,
        options: ["男性", "女性"],
      },
      { sortOrder: 5, label: "電話番号", fieldType: "TEXT", isRequired: false },
      { sortOrder: 6, label: "メールアドレス", fieldType: "TEXT", isRequired: false },
      { sortOrder: 7, label: "郵便番号＆住所", fieldType: "TEXT", isRequired: false },
      { sortOrder: 8, label: "面談予定日", fieldType: "DATE", isRequired: false },
      { sortOrder: 9, label: "誰からの紹介か", fieldType: "TEXT", isRequired: true },
    ],
  },
  {
    name: "RAエントリーのFM登録",
    description: "RAエントリーのファイルメーカー登録依頼",
    fields: [
      { sortOrder: 1, label: "応募先企業名", fieldType: "TEXT", isRequired: true },
      { sortOrder: 2, label: "circus URL", fieldType: "TEXT", isRequired: true },
      { sortOrder: 3, label: "エリア", fieldType: "TEXT", isRequired: true },
    ],
  },
  {
    name: "求人詳細＆登録依頼",
    description: "求人情報の詳細格納および登録の依頼",
    fields: [
      { sortOrder: 1, label: "形式", fieldType: "TEXT", isRequired: true },
      { sortOrder: 2, label: "エリア", fieldType: "TEXT", isRequired: true },
      {
        sortOrder: 3, label: "媒体", fieldType: "CHECKBOX", isRequired: true,
        options: ["HiTo-link", "circus", "マイナビJOB", "クラウドエージェント"],
      },
      { sortOrder: 4, label: "格納先", fieldType: "TEXT", isRequired: true },
    ],
  },
  {
    name: "追加情報取得文作成依頼",
    description: "求職者書類作成に関する追加情報の取得文を作成する依頼",
    fields: [
      {
        sortOrder: 1, label: "写真", fieldType: "RADIO", isRequired: true,
        options: ["必要", "不要"],
      },
    ],
  },
  {
    name: "面接対策依頼",
    description: "求職者の面接対策レクチャーの依頼",
    fields: [
      { sortOrder: 1, label: "選考企業名", fieldType: "TEXT", isRequired: true },
      { sortOrder: 2, label: "選考求人URL", fieldType: "TEXT", isRequired: true },
      { sortOrder: 3, label: "選考からの面接ポイント", fieldType: "TEXTAREA", isRequired: false },
      {
        sortOrder: 4, label: "重点：基礎理解系", fieldType: "CHECKBOX", isRequired: false,
        options: [
          "はじめての面接のため全体的に面接の流れを説明してほしい",
          "面接開始〜終了までの一連のやり取りについてレクチャーしてほしい",
          "社会人経験が浅いためビジネスマナーなど基礎を叩き込んでほしい",
          "人柄的に軌道修正が必要",
        ],
      },
      {
        sortOrder: 5, label: "重点：自己PR・志望動機系", fieldType: "CHECKBOX", isRequired: false,
        options: [
          "職務経歴のどこを重点的に話すべきか整理してほしい",
          "志望動機をその企業向けに語れるようにしてほしい",
          "他責傾向があるので軌道修正してほしい",
        ],
      },
      {
        sortOrder: 6, label: "重点：実践練習系", fieldType: "CHECKBOX", isRequired: false,
        options: [
          "模擬面接をしてフィードバックが欲しい",
          "緊張しやすいので話す練習の場数を踏みたい",
          "表情や話し方の改善点を教えてほしい",
          "想定外の質問への対応練習",
        ],
      },
      {
        sortOrder: 7, label: "重点：企業理解・逆質問系", fieldType: "CHECKBOX", isRequired: false,
        options: [
          "企業研究の仕方をレクチャーしてほしい",
          "逆質問のバリエーション / 回答の方向性を整理してほしい",
        ],
      },
      { sortOrder: 8, label: "候補日1", fieldType: "TEXT", isRequired: true },
      { sortOrder: 9, label: "候補日2", fieldType: "TEXT", isRequired: false },
      { sortOrder: 10, label: "候補日3", fieldType: "TEXT", isRequired: false },
      { sortOrder: 11, label: "その他申し送り事項", fieldType: "TEXTAREA", isRequired: false },
    ],
  },
];

async function main() {
  let created = 0;
  let skipped = 0;

  // 既存カテゴリの最大sortOrder取得
  const existingMax = await prisma.taskCategory.aggregate({ _max: { sortOrder: true } });
  let nextSortOrder = (existingMax._max.sortOrder ?? 0) + 1;

  for (const catDef of CATEGORIES) {
    const existing = await prisma.taskCategory.findFirst({
      where: { name: catDef.name },
    });

    if (existing) {
      console.log(`  スキップ: ${catDef.name}（既に存在）`);
      skipped++;
      continue;
    }

    const category = await prisma.taskCategory.create({
      data: {
        name: catDef.name,
        description: catDef.description,
        sortOrder: nextSortOrder++,
        isActive: true,
      },
    });

    for (const fieldDef of catDef.fields) {
      const field = await prisma.taskTemplateField.create({
        data: {
          categoryId: category.id,
          label: fieldDef.label,
          fieldType: fieldDef.fieldType,
          isRequired: fieldDef.isRequired,
          sortOrder: fieldDef.sortOrder,
        },
      });

      if (fieldDef.options && fieldDef.options.length > 0) {
        for (let i = 0; i < fieldDef.options.length; i++) {
          await prisma.taskTemplateOption.create({
            data: {
              fieldId: field.id,
              label: fieldDef.options[i],
              value: fieldDef.options[i],
              sortOrder: i + 1,
            },
          });
        }
      }
    }

    console.log(`  作成: ${catDef.name}（項目数: ${catDef.fields.length}）`);
    created++;
  }

  console.log(`\n完了: 作成 ${created}件 / スキップ ${skipped}件`);
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

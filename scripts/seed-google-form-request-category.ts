// T-171: タスクカテゴリ「Googleフォーム作成依頼」の登録スクリプト（冪等・新規INSERTのみ）。
// - name 一致のカテゴリが既に存在すればフィールド含め一切触らずスキップする。
// - グループは既存「求職者対応」（TaskCategoryGroup.name）に紐付ける。
// - 実行: 本番コンテナ上で `node`（railway ssh 経由）。seed-task-categories.ts と同じ作法。
import { PrismaClient, TaskFieldType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CATEGORY_NAME = "Googleフォーム作成依頼";
const CATEGORY_DESCRIPTION = "面談前の Google フォーム（履歴書アンケート）作成を依頼する";
const GROUP_NAME = "求職者対応";

// 値はタスク作成ウィザードのカスタムUIが組み立てて格納する（generic 入力では使わない）。
// 「フォーム作成指定データ」は機械用 JSON。ウィザード・タスク詳細の両方でラベル一致により非表示。
// T-172 で「会社別職種分類」を一旦廃止したが、T-172追補で復活（任意入力なので isRequired=false）。
// 会社名・在籍期間はウィザードが WorkHistory から自動表示し、CA が職種を指定して整形テキストを格納する。
const FIELDS: { sortOrder: number; label: string; fieldType: TaskFieldType; isRequired: boolean }[] = [
  { sortOrder: 1, label: "メイン経験職種カテゴリ", fieldType: "TEXT", isRequired: true },
  { sortOrder: 2, label: "会社別職種分類", fieldType: "TEXT", isRequired: false },
  { sortOrder: 3, label: "その他メモ", fieldType: "TEXT", isRequired: false },
  { sortOrder: 4, label: "フォーム作成指定データ", fieldType: "TEXT", isRequired: false },
];

async function main() {
  const existing = await prisma.taskCategory.findFirst({ where: { name: CATEGORY_NAME } });
  if (existing) {
    console.log(`スキップ: ${CATEGORY_NAME}（既に存在 id=${existing.id}）`);
    return;
  }

  const group = await prisma.taskCategoryGroup.findFirst({ where: { name: GROUP_NAME } });
  if (!group) {
    throw new Error(`グループ「${GROUP_NAME}」が見つかりません。中止します。`);
  }

  // グループ内の表示順は既存カテゴリの最大 sortOrder + 1（求職者対応: エントリー対応=1〜アンケート対応=4）
  const maxInGroup = await prisma.taskCategory.aggregate({
    where: { groupId: group.id },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxInGroup._max.sortOrder ?? 0) + 1;

  const category = await prisma.taskCategory.create({
    data: {
      name: CATEGORY_NAME,
      description: CATEGORY_DESCRIPTION,
      sortOrder,
      isActive: true,
      groupId: group.id,
    },
  });

  for (const f of FIELDS) {
    await prisma.taskTemplateField.create({
      data: {
        categoryId: category.id,
        label: f.label,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        sortOrder: f.sortOrder,
      },
    });
  }

  console.log(`作成: ${CATEGORY_NAME} id=${category.id} group=${group.name} sortOrder=${sortOrder} 項目数=${FIELDS.length}`);
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

export {};

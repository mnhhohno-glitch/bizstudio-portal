import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_ID = "cmoal05cp002r1dsxyokhti3i";

type FieldDef = {
  label: string;
  fieldType: "TEXT" | "TEXTAREA" | "CHECKBOX" | "SELECT" | "MULTI_SELECT";
  isRequired: boolean;
  placeholder?: string;
  sortOrder: number;
  options?: { label: string; value: string; sortOrder: number }[];
};

const FIELDS: FieldDef[] = [
  // === 基本情報 ===
  { label: "応募職種", fieldType: "TEXT", isRequired: true, placeholder: "例: 営業職", sortOrder: 1 },
  { label: "提示できる実績や数字がない（「数字実績なしで構いません」と記載する）", fieldType: "CHECKBOX", isRequired: false, sortOrder: 2 },

  // === 履歴書 ===
  { label: "[履歴書] 志望動機（大分類）", fieldType: "TEXT", isRequired: true, sortOrder: 3 },
  { label: "[履歴書] 志望動機（中分類）", fieldType: "TEXT", isRequired: true, sortOrder: 4 },
  { label: "[履歴書] 志望動機（小分類）", fieldType: "TEXT", isRequired: true, sortOrder: 5 },
  { label: "[履歴書] 追加メモ", fieldType: "TEXTAREA", isRequired: false, placeholder: "補足情報があれば入力してください", sortOrder: 6 },

  // === 職務経歴書 ===
  { label: "[職務経歴書] 作成ポイント・指示", fieldType: "TEXTAREA", isRequired: false, placeholder: "例: 営業向けの書類を作成してほしい", sortOrder: 7 },
  { label: "[職務経歴書] 営業実績", fieldType: "TEXTAREA", isRequired: false, placeholder: "直近3年の目標/実績（目標:○○万円/実績:○○万円/達成率:○○%）", sortOrder: 8 },
  { label: "[職務経歴書] その他実績", fieldType: "TEXTAREA", isRequired: false, placeholder: "例: 20○○年度新規契約件数において全社○名中○位の実績により表彰される", sortOrder: 9 },
  { label: "[職務経歴書] 自己PR参考情報", fieldType: "TEXTAREA", isRequired: false, placeholder: "追加メモやマイナビ転職のレジュメを参考に作成ください", sortOrder: 10 },

  // === 推薦状 ===
  {
    label: "[推薦状] 在籍状況", fieldType: "SELECT", isRequired: true, sortOrder: 11,
    options: [
      { label: "在職中", value: "在職中", sortOrder: 1 },
      { label: "退職済", value: "退職済", sortOrder: 2 },
    ],
  },
  { label: "[推薦状] 入社時期", fieldType: "TEXT", isRequired: false, placeholder: "例: 2026年4月1日以降", sortOrder: 12 },
  { label: "[推薦状] 年収情報", fieldType: "TEXT", isRequired: false, placeholder: "現在（前職）●●●万円 / 希望●●●万円〜●●●万円", sortOrder: 13 },
  {
    label: "[推薦状] 人物像", fieldType: "MULTI_SELECT", isRequired: true, sortOrder: 14,
    options: [
      { label: "コミュニケーション力", value: "コミュニケーション力", sortOrder: 1 },
      { label: "協調性/チームワーク", value: "協調性/チームワーク", sortOrder: 2 },
      { label: "誠実さ/信頼感", value: "誠実さ/信頼感", sortOrder: 3 },
      { label: "責任感/真面目さ", value: "責任感/真面目さ", sortOrder: 4 },
      { label: "柔軟性/適応力", value: "柔軟性/適応力", sortOrder: 5 },
      { label: "向上心/成長意欲", value: "向上心/成長意欲", sortOrder: 6 },
      { label: "ポジティブ思考", value: "ポジティブ思考", sortOrder: 7 },
      { label: "忍耐力/粘り強さ", value: "忍耐力/粘り強さ", sortOrder: 8 },
      { label: "リーダーシップ/主体性", value: "リーダーシップ/主体性", sortOrder: 9 },
      { label: "ホスピタリティ精神（気配り・思いやり）", value: "ホスピタリティ精神（気配り・思いやり）", sortOrder: 10 },
      { label: "学習意欲/吸収力", value: "学習意欲/吸収力", sortOrder: 11 },
      { label: "実務経験/専門知識", value: "実務経験/専門知識", sortOrder: 12 },
      { label: "問題解決力/分析力", value: "問題解決力/分析力", sortOrder: 13 },
      { label: "プレゼンテーション力/説得力", value: "プレゼンテーション力/説得力", sortOrder: 14 },
      { label: "調整力/コーディネーション力", value: "調整力/コーディネーション力", sortOrder: 15 },
      { label: "マネジメント経験（後輩指導・育成）", value: "マネジメント経験（後輩指導・育成）", sortOrder: 16 },
      { label: "PCスキル/ITリテラシー", value: "PCスキル/ITリテラシー", sortOrder: 17 },
      { label: "語学力/国際感覚", value: "語学力/国際感覚", sortOrder: 18 },
    ],
  },
  { label: "[推薦状] 人物像補足", fieldType: "TEXTAREA", isRequired: false, placeholder: "上記をベースに人物像紹介文についての追加指示があれば入力", sortOrder: 15 },
  {
    label: "[推薦状] 転職理由", fieldType: "MULTI_SELECT", isRequired: true, sortOrder: 16,
    options: [
      { label: "これまでの経験を活かしつつ、新しい業務領域に挑戦したい", value: "これまでの経験を活かしつつ、新しい業務領域に挑戦したい", sortOrder: 1 },
      { label: "より専門性を高めて市場価値を上げたい", value: "より専門性を高めて市場価値を上げたい", sortOrder: 2 },
      { label: "成長スピードの速い環境でスキルを磨きたい", value: "成長スピードの速い環境でスキルを磨きたい", sortOrder: 3 },
      { label: "幅広い業務を経験してキャリアの選択肢を広げたい", value: "幅広い業務を経験してキャリアの選択肢を広げたい", sortOrder: 4 },
      { label: "将来のキャリアビジョンに沿った経験を積みたい", value: "将来のキャリアビジョンに沿った経験を積みたい", sortOrder: 5 },
      { label: "営業としてのキャリアをより明確にしたい", value: "営業としてのキャリアをより明確にしたい", sortOrder: 6 },
      { label: "長期的に腰を据えて働ける環境を求めたい", value: "長期的に腰を据えて働ける環境を求めたい", sortOrder: 7 },
      { label: "成果が正当に評価される環境で働きたい", value: "成果が正当に評価される環境で働きたい", sortOrder: 8 },
      { label: "チームワークを重視する社風で力を発揮したい", value: "チームワークを重視する社風で力を発揮したい", sortOrder: 9 },
      { label: "社会貢献性の高い事業に携わりたい", value: "社会貢献性の高い事業に携わりたい", sortOrder: 10 },
      { label: "グローバル環境/新しい業界で経験を積みたい", value: "グローバル環境/新しい業界で経験を積みたい", sortOrder: 11 },
      { label: "安定した基盤のある企業で長期的に成長したい", value: "安定した基盤のある企業で長期的に成長したい", sortOrder: 12 },
      { label: "ワークライフバランスを確保しつつ成果を出したい", value: "ワークライフバランスを確保しつつ成果を出したい", sortOrder: 13 },
      { label: "自分の強みを最大限に活かせる職場で働きたい", value: "自分の強みを最大限に活かせる職場で働きたい", sortOrder: 14 },
      { label: "お客様に直接価値を届けられる環境を求めたい", value: "お客様に直接価値を届けられる環境を求めたい", sortOrder: 15 },
      { label: "サポート体制の整った環境で力を発揮したい", value: "サポート体制の整った環境で力を発揮したい", sortOrder: 16 },
    ],
  },
  { label: "[推薦状] 転職理由コメント", fieldType: "TEXTAREA", isRequired: false, placeholder: "転職理由の補足コメント", sortOrder: 17 },
];

async function main() {
  // 冪等チェック
  const existing = await prisma.taskTemplateField.count({
    where: { categoryId: TARGET_ID },
  });
  if (existing > 0) {
    console.log(`Already has ${existing} fields. Skipping.`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // 対象タスクマスターの存在確認
  const cat = await prisma.taskCategory.findUnique({ where: { id: TARGET_ID } });
  if (!cat) {
    console.error(`TaskCategory ${TARGET_ID} not found!`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  }
  console.log(`Target: ${cat.name} (${cat.id})`);

  let created = 0;
  for (const field of FIELDS) {
    const { options, ...fieldData } = field;
    const f = await prisma.taskTemplateField.create({
      data: {
        categoryId: TARGET_ID,
        label: fieldData.label,
        fieldType: fieldData.fieldType,
        isRequired: fieldData.isRequired,
        placeholder: fieldData.placeholder || null,
        sortOrder: fieldData.sortOrder,
        ...(options && options.length > 0
          ? { options: { create: options } }
          : {}),
      },
      include: { options: true },
    });
    const optCount = f.options?.length || 0;
    console.log(`  Created [${f.sortOrder}] "${f.label}" (${f.fieldType}${optCount > 0 ? `, ${optCount} options` : ""})`);
    created++;
  }

  console.log(`\nDone: ${created} fields created.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

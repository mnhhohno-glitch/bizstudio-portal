import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 監査ログ用 anonymous ユーザー
  await prisma.user.upsert({
    where: { email: "anonymous@local" },
    update: {},
    create: {
      name: "Anonymous",
      email: "anonymous@local",
      passwordHash: bcrypt.hashSync("not-used", 10),
      role: "member",
      status: "active",
    },
  });

  // admin@local を削除（不要なため）
  const oldAdmin = await prisma.user.findUnique({ where: { email: "admin@local" } });
  if (oldAdmin) {
    await prisma.user.delete({ where: { email: "admin@local" } });
    console.log("Deleted old admin@local user");
  }

  // 正式な管理者アカウント: 大野 将幸
  await prisma.user.upsert({
    where: { email: "masayuki_oono@bizstudio.co.jp" },
    update: { role: "admin" },
    create: {
      name: "大野 将幸",
      email: "masayuki_oono@bizstudio.co.jp",
      passwordHash: bcrypt.hashSync("BizStudio2026!", 10),
      role: "admin",
      status: "active",
    },
  });
  console.log("Admin user configured: masayuki_oono@bizstudio.co.jp");

  // 社員マスターデータ
  const employees = [
    { employeeNumber: "BS1000001", name: "大野 将幸" },
    { employeeNumber: "BS1000007", name: "岡田 愛子" },
    { employeeNumber: "BS1000008", name: "安藤 嘉富" },
    { employeeNumber: "BS1000009", name: "南條 雄三" },
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { employeeNumber: emp.employeeNumber },
      update: { name: emp.name },
      create: {
        employeeNumber: emp.employeeNumber,
        name: emp.name,
        status: "active",
      },
    });
  }

  // 求職者マスターデータ（全アプリから収集）
  const candidates = [
    // candidate-intake から
    { candidateNumber: "5003981", name: "東 裕太郎" },
    { candidateNumber: "5003965", name: "原 直希" },
    { candidateNumber: "5003994", name: "丸山 瑠花" },
    { candidateNumber: "5004013", name: "江崎 悠翔" },
    { candidateNumber: "5003564", name: "千葉 明美" },
    { candidateNumber: "5004014", name: "梶原 周良" },
    // kyuujinnPDF から（重複除去済み）
    { candidateNumber: "5003966", name: "加茂 優斗" },
    { candidateNumber: "5003681", name: "大林 莉々佳" },
    { candidateNumber: "5003352", name: "下條 葵" },
    { candidateNumber: "5003975", name: "柳田 颯希" },
    { candidateNumber: "5003478", name: "吉田 侑加" },
    { candidateNumber: "5003921", name: "司馬 華孜" },
    { candidateNumber: "5004016", name: "飯田 朋香" },
    { candidateNumber: "5004012", name: "山本 航輝" },
    { candidateNumber: "5003731", name: "伊村 美紅" },
    { candidateNumber: "5004000", name: "寺原 弘惇" },
    { candidateNumber: "5003986", name: "岡部 智美" },
    { candidateNumber: "5003976", name: "上谷 日菜子" },
    { candidateNumber: "5003943", name: "高橋 陽生" },
    { candidateNumber: "5003897", name: "鈴木 彩紀子" },
    { candidateNumber: "5003992", name: "角野 太一" },
    { candidateNumber: "5003861", name: "中村 樹" },
    { candidateNumber: "5003830", name: "青木 舞桜" },
    { candidateNumber: "5000717", name: "阿部 琴音" },
    { candidateNumber: "5003971", name: "蟹澤 舞奈" },
    { candidateNumber: "5003974", name: "野澤 幸" },
    { candidateNumber: "5003987", name: "平野 総一朗" },
    { candidateNumber: "5003963", name: "三嶋 あいり" },
    { candidateNumber: "5003956", name: "大澤 優貴" },
    { candidateNumber: "5003875", name: "松島 花" },
    { candidateNumber: "5003942", name: "伊藤 香琳" },
    { candidateNumber: "5003888", name: "山川 海都" },
    { candidateNumber: "5003869", name: "綾部 望美" },
    { candidateNumber: "5003960", name: "山本 愛莉" },
    { candidateNumber: "5003766", name: "田畑 陽向" },
    { candidateNumber: "5003868", name: "山本 海与" },
    { candidateNumber: "5003545", name: "富岡 大喜" },
    { candidateNumber: "5003890", name: "田原 みくり" },
    { candidateNumber: "5003944", name: "吉原 ことみ" },
    { candidateNumber: "5003935", name: "渡邉 明照" },
    { candidateNumber: "5003959", name: "堀内 由鈴" },
    { candidateNumber: "5003950", name: "神田 奈緒" },
    { candidateNumber: "5003893", name: "飯塚 蓮" },
    { candidateNumber: "5003625", name: "岡本 沙羅" },
    { candidateNumber: "5003755", name: "臼田 麗" },
    { candidateNumber: "5003926", name: "柴田 輝" },
    { candidateNumber: "5003945", name: "澤田 亜瑠々" },
    { candidateNumber: "5003854", name: "岩田 美優" },
    { candidateNumber: "5003855", name: "紺野 潮音" },
    { candidateNumber: "5003841", name: "大貫 玲奈" },
    { candidateNumber: "5003955", name: "中野 祥汰" },
    { candidateNumber: "5003904", name: "田中 双葉" },
    { candidateNumber: "5003937", name: "佐々木 優樹" },
    { candidateNumber: "5003860", name: "商崎 由唯香" },
    { candidateNumber: "5003936", name: "山田 実優" },
    { candidateNumber: "5003879", name: "上原 彩乃" },
    { candidateNumber: "5003902", name: "原田 将臣" },
    { candidateNumber: "5003660", name: "福原 優芽" },
    { candidateNumber: "5003747", name: "籌 莉菜" },
    { candidateNumber: "5003866", name: "松浦 希" },
    { candidateNumber: "5003804", name: "永園 みずき" },
    { candidateNumber: "5003156", name: "工藤 篤" },
    { candidateNumber: "5003907", name: "金子 ひなた" },
    { candidateNumber: "5003905", name: "本田 りた" },
    { candidateNumber: "5003873", name: "小幡 美友" },
    { candidateNumber: "5003477", name: "菅原 真美" },
    { candidateNumber: "5003883", name: "平 紅葉" },
    { candidateNumber: "5003880", name: "廣田 夏花" },
    { candidateNumber: "5003914", name: "久木原 瑞季" },
    { candidateNumber: "5003896", name: "千本 晃楽" },
    { candidateNumber: "5003058", name: "盛重 光輝" },
    { candidateNumber: "5003885", name: "松本 優芽" },
    { candidateNumber: "5003909", name: "岡野 悠菜" },
  ];

  for (const cand of candidates) {
    await prisma.candidate.upsert({
      where: { candidateNumber: cand.candidateNumber },
      update: { name: cand.name },
      create: {
        candidateNumber: cand.candidateNumber,
        name: cand.name,
      },
    });
  }
  console.log(`Seeded ${candidates.length} candidates`);

  // システムリンク（連携アプリ）
  const systemLinks = [
    {
      name: "求人PDF解析ツール",
      description: "求人票PDFから情報を抽出し、求職者向け資料を生成",
      url: "https://kyuujin-pdf-tool-production.up.railway.app",
      sortOrder: 1,
      requiresAuth: false,
      appId: null,
    },
    {
      name: "候補者情報取り込み",
      description: "求職者の履歴書・職務経歴書から質問文を生成",
      url: "https://candidate-intake-production.up.railway.app",
      sortOrder: 2,
      requiresAuth: false,
      appId: null,
    },
    {
      name: "面接対策資料作成",
      description: "求職者向けの支援計画書・面接対策資料を生成",
      url: "https://tender-reverence-production.up.railway.app",
      sortOrder: 3,
      requiresAuth: true,
      appId: "material_creator",
    },
    {
      name: "履歴書・職務経歴書生成",
      description: "PDFとExcelから履歴書・職務経歴書を自動生成",
      url: "https://ai-resume-generator-production-66cb.up.railway.app",
      sortOrder: 4,
      requiresAuth: true,
      appId: "ai-resume-generator",
    },
  ];

  for (const sys of systemLinks) {
    // URLで既存チェック（重複登録を防ぐ）
    const existing = await prisma.systemLink.findFirst({
      where: { url: sys.url },
    });
    if (!existing) {
      await prisma.systemLink.create({
        data: {
          name: sys.name,
          description: sys.description,
          url: sys.url,
          sortOrder: sys.sortOrder,
          status: "active",
          requiresAuth: sys.requiresAuth,
          appId: sys.appId,
        },
      });
      console.log(`Created system link: ${sys.name}`);
    } else {
      // 既存の場合は requiresAuth, appId を更新
      await prisma.systemLink.update({
        where: { id: existing.id },
        data: {
          requiresAuth: sys.requiresAuth,
          appId: sys.appId,
        },
      });
      console.log(`Updated system link: ${sys.name}`);
    }
  }

  console.log("Seed completed: users, employees, and system links created");

  // ========== 志望動機マスター初期データ ==========
  console.log("\n=== 志望動機マスター初期データ投入 ===");

  type MinorData = { name: string; sortOrder: number };
  type MiddleData = { name: string; sortOrder: number; minors: MinorData[] };
  type MajorData = { name: string; sortOrder: number; middles: MiddleData[] };

  const motivationCategoriesPath = join(__dirname, "..", "motivation-categories.json");
  const motivationCategories: MajorData[] = JSON.parse(readFileSync(motivationCategoriesPath, "utf-8"));

  for (const major of motivationCategories) {
    const majorRec = await prisma.motivationCategoryMajor.upsert({
      where: { name: major.name },
      update: { sortOrder: major.sortOrder },
      create: { name: major.name, sortOrder: major.sortOrder },
    });

    for (const middle of major.middles) {
      let middleRec = await prisma.motivationCategoryMiddle.findFirst({
        where: { majorId: majorRec.id, name: middle.name },
      });
      if (!middleRec) {
        middleRec = await prisma.motivationCategoryMiddle.create({
          data: { name: middle.name, majorId: majorRec.id, sortOrder: middle.sortOrder },
        });
      } else {
        await prisma.motivationCategoryMiddle.update({
          where: { id: middleRec.id },
          data: { sortOrder: middle.sortOrder },
        });
      }

      for (const minor of middle.minors) {
        const existingMinor = await prisma.motivationCategoryMinor.findFirst({
          where: { middleId: middleRec.id, name: minor.name },
        });
        if (!existingMinor) {
          await prisma.motivationCategoryMinor.create({
            data: { name: minor.name, middleId: middleRec.id, sortOrder: minor.sortOrder },
          });
        }
      }
    }
  }
  console.log(`志望動機マスター投入完了: ${motivationCategories.length} 大分類`);

  // ========== 職種マスター初期データ ==========
  console.log("\n=== 職種マスター初期データ投入 ===");

  const jobCategoriesPath = join(__dirname, "..", "job-categories.json");
  const jobCategories: MajorData[] = JSON.parse(readFileSync(jobCategoriesPath, "utf-8"));

  for (const major of jobCategories) {
    const majorRec = await prisma.jobCategoryMajor.upsert({
      where: { name: major.name },
      update: { sortOrder: major.sortOrder },
      create: { name: major.name, sortOrder: major.sortOrder },
    });

    for (const middle of major.middles) {
      let middleRec = await prisma.jobCategoryMiddle.findFirst({
        where: { majorId: majorRec.id, name: middle.name },
      });
      if (!middleRec) {
        middleRec = await prisma.jobCategoryMiddle.create({
          data: { name: middle.name, majorId: majorRec.id, sortOrder: middle.sortOrder },
        });
      } else {
        await prisma.jobCategoryMiddle.update({
          where: { id: middleRec.id },
          data: { sortOrder: middle.sortOrder },
        });
      }

      for (const minor of middle.minors) {
        const existingMinor = await prisma.jobCategoryMinor.findFirst({
          where: { middleId: middleRec.id, name: minor.name },
        });
        if (!existingMinor) {
          await prisma.jobCategoryMinor.create({
            data: { name: minor.name, middleId: middleRec.id, sortOrder: minor.sortOrder },
          });
        }
      }
    }
  }
  console.log(`職種マスター投入完了: ${jobCategories.length} 大分類`);

  // ========== タスクマスター初期データ ==========
  console.log("\n=== タスクマスター初期データ投入 ===");

  async function upsertCategory(name: string, sortOrder: number) {
    const existing = await prisma.taskCategory.findFirst({ where: { name } });
    if (existing) {
      console.log(`  [skip] カテゴリ "${name}" は既に存在します`);
      return existing;
    }
    const cat = await prisma.taskCategory.create({ data: { name, sortOrder } });
    console.log(`  [create] カテゴリ "${name}"`);
    return cat;
  }

  async function upsertField(
    categoryId: string,
    label: string,
    fieldType: "TEXT" | "TEXTAREA" | "SELECT" | "MULTI_SELECT" | "DATE" | "CHECKBOX",
    isRequired: boolean,
    sortOrder: number,
    placeholder?: string
  ) {
    const existing = await prisma.taskTemplateField.findFirst({ where: { categoryId, label } });
    if (existing) {
      console.log(`    [skip] 項目 "${label}" は既に存在します`);
      return existing;
    }
    const field = await prisma.taskTemplateField.create({
      data: { categoryId, label, fieldType, isRequired, sortOrder, placeholder },
    });
    console.log(`    [create] 項目 "${label}"`);
    return field;
  }

  async function upsertOption(fieldId: string, label: string, sortOrder: number) {
    const existing = await prisma.taskTemplateOption.findFirst({ where: { fieldId, sortOrder } });
    if (existing) return existing;
    return prisma.taskTemplateOption.create({
      data: { fieldId, label, value: label, sortOrder },
    });
  }

  // === 既存データの修正 ===
  // 履歴書作成カテゴリの旧「志望動機カテゴリ」「志望動機の詳細」フィールドを削除
  const cat1 = await upsertCategory("履歴書作成", 1);

  const oldMotivationLabels = ["志望動機カテゴリ", "志望動機の詳細"];
  for (const label of oldMotivationLabels) {
    const oldField = await prisma.taskTemplateField.findFirst({
      where: { categoryId: cat1.id, label },
    });
    if (oldField) {
      await prisma.taskTemplateField.delete({ where: { id: oldField.id } });
      console.log(`    [delete] 旧項目 "${label}"`);
    }
  }

  // 新しい志望動機フィールド（大中小 + 追加メモ）
  await upsertField(cat1.id, "志望動機（大分類）", "TEXT", true, 1);
  await upsertField(cat1.id, "志望動機（中分類）", "TEXT", true, 2);
  await upsertField(cat1.id, "志望動機（小分類）", "TEXT", true, 3);
  await upsertField(cat1.id, "追加メモ", "TEXTAREA", false, 4, "補足情報があれば入力してください");

  // カテゴリ2: 職務経歴書作成
  const cat2 = await upsertCategory("職務経歴書作成", 2);

  await upsertField(cat2.id, "応募職種", "TEXT", true, 1, "例: 営業職");
  await upsertField(cat2.id, "作成ポイント・指示", "TEXTAREA", false, 2, "例: 営業向けの書類を作成してほしい");
  await upsertField(cat2.id, "提示できる実績や数字がない（「数字実績なしで構いません」と記載する）", "CHECKBOX", false, 3);
  await upsertField(cat2.id, "営業実績", "TEXTAREA", false, 4, "直近3年の目標/実績（目標:○○万円/実績:○○万円/達成率:○○%）");
  await upsertField(cat2.id, "その他実績", "TEXTAREA", false, 5, "例: 20○○年度新規契約件数において全社○名中○位の実績により表彰される");
  await upsertField(cat2.id, "自己PR参考情報", "TEXTAREA", false, 6, "追加メモやマイナビ転職のレジュメを参考に作成ください");

  // カテゴリ3: 推薦状作成
  const cat3 = await upsertCategory("推薦状作成", 3);

  const f3_1 = await upsertField(cat3.id, "在籍状況", "SELECT", true, 1);
  await upsertOption(f3_1.id, "在職中", 1);
  await upsertOption(f3_1.id, "退職済", 2);

  await upsertField(cat3.id, "入社時期", "TEXT", false, 2, "例: 2026年4月1日以降");
  await upsertField(cat3.id, "年収情報", "TEXT", false, 3, "現在（前職）●●●万円 / 希望●●●万円〜●●●万円");

  const f3_4 = await upsertField(cat3.id, "人物像", "MULTI_SELECT", true, 4);
  for (const [i, label] of [
    "コミュニケーション力",
    "協調性/チームワーク",
    "誠実さ/信頼感",
    "責任感/真面目さ",
    "柔軟性/適応力",
    "向上心/成長意欲",
    "ポジティブ思考",
    "忍耐力/粘り強さ",
    "リーダーシップ/主体性",
    "ホスピタリティ精神（気配り・思いやり）",
    "学習意欲/吸収力",
    "実務経験/専門知識",
    "問題解決力/分析力",
    "プレゼンテーション力/説得力",
    "調整力/コーディネーション力",
    "マネジメント経験（後輩指導・育成）",
    "PCスキル/ITリテラシー",
    "語学力/国際感覚",
  ].entries()) {
    await upsertOption(f3_4.id, label, i + 1);
  }

  await upsertField(cat3.id, "人物像補足", "TEXTAREA", false, 5, "上記をベースに人物像紹介文についての追加指示があれば入力");

  const f3_6 = await upsertField(cat3.id, "転職理由", "MULTI_SELECT", true, 6);
  for (const [i, label] of [
    "これまでの経験を活かしつつ、新しい業務領域に挑戦したい",
    "より専門性を高めて市場価値を上げたい",
    "成長スピードの速い環境でスキルを磨きたい",
    "幅広い業務を経験してキャリアの選択肢を広げたい",
    "将来のキャリアビジョンに沿った経験を積みたい",
    "営業としてのキャリアをより明確にしたい",
    "長期的に腰を据えて働ける環境を求めたい",
    "成果が正当に評価される環境で働きたい",
    "チームワークを重視する社風で力を発揮したい",
    "社会貢献性の高い事業に携わりたい",
    "グローバル環境/新しい業界で経験を積みたい",
    "安定した基盤のある企業で長期的に成長したい",
    "ワークライフバランスを確保しつつ成果を出したい",
    "自分の強みを最大限に活かせる職場で働きたい",
    "お客様に直接価値を届けられる環境を求めたい",
    "サポート体制の整った環境で力を発揮したい",
  ].entries()) {
    await upsertOption(f3_6.id, label, i + 1);
  }

  await upsertField(cat3.id, "転職理由コメント", "TEXTAREA", false, 7, "転職理由の補足コメント");

  // カテゴリ4: エントリー対応
  const cat4 = await upsertCategory("エントリー対応", 4);

  // 旧項目を削除して新項目に入れ替え
  const oldEntryFields = await prisma.taskTemplateField.findMany({ where: { categoryId: cat4.id } });
  const newEntryLabels = ["エントリー日", "エントリー件数", "コメント"];
  for (const oldField of oldEntryFields) {
    if (!newEntryLabels.includes(oldField.label)) {
      await prisma.taskTemplateField.delete({ where: { id: oldField.id } });
      console.log(`    [delete] 旧項目 "${oldField.label}"`);
    }
  }

  await upsertField(cat4.id, "エントリー日", "DATE", true, 1);
  await upsertField(cat4.id, "エントリー件数", "TEXT", true, 2, "5");
  await upsertField(cat4.id, "コメント", "TEXTAREA", false, 3, "補足事項があれば入力してください");

  // カテゴリ5: その他
  const cat5 = await upsertCategory("その他", 5);

  await upsertField(cat5.id, "タスク内容", "TEXTAREA", true, 1, "タスクの内容を入力してください");

  console.log("タスクマスター初期データ投入完了");
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

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
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

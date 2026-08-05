// 記述式ワーク（職種・業種当て）の設問seed
// 実行: npx tsx prisma/seed-training-work.ts
// upsert（workKey + itemCode）なので再実行しても重複しない
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const WORK_KEY = "work0-shokushu-gyoshu";

// 業種名・会社名・職種分類は含めない（研修生が推測する対象のため）
const ITEMS: { itemCode: string; title: string; jobContent: string }[] = [
  {
    itemCode: "J-01",
    title: "営業サポート事務（未経験歓迎／土日祝休み）",
    jobContent:
      "営業部門のサポート業務全般をお任せします。\n・売上データの集計、レポート作成\n・営業活動の進捗管理、資料作成の補助\n・受注内容の入力、社内システムへの登録\n・電話、メールでの問い合わせ対応",
  },
  {
    itemCode: "J-02",
    title: "就労サポート事務（障がい者雇用支援／未経験歓迎）",
    jobContent:
      "企業の障がい者雇用の立ち上げから定着までを支援します。\n・導入企業への訪問、運用状況のヒアリング\n・就労者の面談、勤怠と業務進捗の管理\n・報告書、資料の作成（事務業務は全体の4割程度）\n・拠点の運営管理、備品発注",
  },
  {
    itemCode: "J-03",
    title: "一般事務（残業ほぼなし／年間休日125日）",
    jobContent:
      "本社管理部での事務業務をお任せします。\n・書類のファイリング、データ入力\n・電話、来客対応\n・郵便物の仕分け、備品の管理\n・各部署からの依頼業務のサポート",
  },
  {
    itemCode: "J-04",
    title: "店舗運営スタッフ（幹部候補／全国募集）",
    jobContent:
      "全国の直営店にて、接客販売および店舗運営をお任せします。\n・接客、レジ、商品陳列\n・売上管理、発注、在庫管理\n・アルバイトスタッフのシフト作成と育成\n・将来的にはエリアマネージャーとして複数店舗を統括",
  },
  {
    itemCode: "J-05",
    title: "医療事務（未経験OK／年間休日120日）",
    jobContent:
      "クリニックの受付および医療事務をお任せします。\n・受付、電話対応、患者様の案内\n・レセプト（診療報酬明細書）の作成補助\n・カルテの管理、データ入力",
  },
  {
    itemCode: "J-06",
    title: "本社スタッフ職（総合職／企画・管理部門）",
    jobContent:
      "本社の企画・管理部門にて、以下の業務をお任せします。\n・新規出店の企画、市場調査\n・販促キャンペーンの立案と実行\n・売上データの分析、レポート作成\n・店舗運営のサポート、マニュアル整備\n\n【入社後の流れ】\nまずは現場を理解していただくため、直営店舗にて店舗運営業務を経験していただきます（目安2年）。その後、適性に応じて本社の各部門へ配属となります。",
  },
  {
    itemCode: "J-07",
    title: "法人営業（既存顧客中心／インセンティブあり）",
    jobContent:
      "自社開発の業務システムを、既存の法人顧客へ提案します。\n・既存顧客への定期訪問、追加提案\n・顧客の課題ヒアリングと解決策の提示\n・見積書、提案書の作成\n・導入後のフォロー",
  },
  {
    itemCode: "J-08",
    title: "営業アシスタント（未経験歓迎／東証プライム上場グループ）",
    jobContent:
      "広告の進行管理業務をお任せします。\n・広告原稿のチェック（著作権、表現、法令）\n・各広告媒体の管理画面への入稿作業\n・配信後のレポート作成、数値の集計\n・営業担当のサポート、売上管理",
  },
  {
    itemCode: "J-09",
    title: "営業事務（土日祝休み）",
    jobContent:
      "営業部門の事務サポートをお任せします。\n・受注データの入力、納期の調整\n・見積書、請求書の作成\n・電話、メールでの取引先対応\n・展示会の準備補助",
  },
  {
    itemCode: "J-10",
    title: "経理担当（月次決算／簿記3級以上）",
    jobContent:
      "経理部にて以下の業務をお任せします。\n・伝票の起票、仕訳入力\n・月次決算、年次決算の補助\n・売掛金、買掛金の管理\n・支払処理、請求書の発行",
  },
];

async function main() {
  let count = 0;
  for (const [i, item] of ITEMS.entries()) {
    const data = {
      sortOrder: i + 1,
      title: item.title,
      jobContent: item.jobContent,
      isActive: true,
    };
    await prisma.trainingWorkItem.upsert({
      where: { workKey_itemCode: { workKey: WORK_KEY, itemCode: item.itemCode } },
      update: data,
      create: { workKey: WORK_KEY, itemCode: item.itemCode, ...data },
    });
    count++;
  }
  console.log(`Seeded ${count} training work items (workKey=${WORK_KEY})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

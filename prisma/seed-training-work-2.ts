// 記述式ワーク①②③④の設問（TrainingWorkItem）を投入する
// 実行: npx tsx prisma/seed-training-work-2.ts
// [workKey, itemCode] で upsert。既存のワーク⓪（work0-shokushu-gyoshu）には一切触れない
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PROTECTED_WORK_KEY = "work0-shokushu-gyoshu";

type Item = { itemCode: string; title: string; jobContent: string };

const WORKS: { workKey: string; items: Item[] }[] = [
  {
    workKey: "work1-eigyo-3jiku",
    items: [
      {
        itemCode: "J-11",
        title: "人材コーディネーター（法人新規開拓／無形商材）",
        jobContent:
          "企業の採用課題を解決する提案営業です。\n・新規企業へのテレアポ、飛び込み訪問\n・採用課題のヒアリング、求人提案\n・求職者と企業のマッチング\n・契約後のフォロー、条件交渉",
      },
      {
        itemCode: "J-12",
        title: "ルート営業（既存取引先への定期訪問）",
        jobContent:
          "自社製造の食品を、既存の取引先へ届ける営業です。\n・スーパー、小売店への定期訪問（1日6〜8件）\n・売れ筋商品のご案内、陳列の提案\n・受注、納品数の調整\n・新商品のサンプル提供\n※新規開拓はありません。ノルマもありません。",
      },
      {
        itemCode: "J-13",
        title: "ライフプランナー（個人向け）",
        jobContent:
          "個人のお客様に、保障プランをご提案します。\n・お客様のライフプランのヒアリング\n・保険商品の設計、提案\n・ご契約後の定期的なフォロー、見直し提案\n・紹介の依頼、新規顧客の開拓",
      },
      {
        itemCode: "J-14",
        title: "ショールームアドバイザー（来店型）",
        jobContent:
          "ショールームにご来店されたお客様への接客と提案です。\n・キッチン、バス、洗面設備のご案内\n・お客様の要望に合わせたプランニング、見積作成\n・工務店、リフォーム会社との日程調整\n・ショールームの展示管理\n※飛び込みやテレアポはありません。",
      },
    ],
  },
  {
    workKey: "work2-jimu-bunrui",
    items: [
      {
        itemCode: "J-03",
        title: "一般事務（残業ほぼなし／年間休日125日）",
        jobContent:
          "本社管理部での事務業務をお任せします。\n・書類のファイリング、データ入力\n・電話、来客対応\n・郵便物の仕分け、備品の管理\n・各部署からの依頼業務のサポート",
      },
      {
        itemCode: "J-08",
        title: "営業アシスタント（未経験歓迎）",
        jobContent:
          "広告の進行管理業務をお任せします。\n・広告原稿のチェック（著作権、表現、法令）\n・各広告媒体の管理画面への入稿作業\n・配信後のレポート作成、数値の集計\n・営業担当のサポート、売上管理",
      },
      {
        itemCode: "J-10",
        title: "経理担当（月次決算／簿記3級以上）",
        jobContent:
          "経理部にて以下の業務をお任せします。\n・伝票の起票、仕訳入力\n・月次決算、年次決算の補助\n・売掛金、買掛金の管理\n・支払処理、請求書の発行",
      },
      {
        itemCode: "J-16",
        title: "営業事務（土日祝休み）",
        jobContent:
          "メーカーから仕入れた建築資材の受発注業務をお任せします。\n・工務店、住宅メーカーからの注文受付（FAX、メール）\n・仕入先メーカーへの発注、納期調整\n・注文書のチェック、入力\n・請求書の発行、売掛金の確認",
      },
      {
        itemCode: "J-17",
        title: "総務・人事アシスタント（未経験歓迎）",
        jobContent:
          "管理部にて、総務と人事の業務をお任せします。\n・入退社手続き、社会保険の手続き\n・勤怠データの集計、給与計算の補助\n・備品、消耗品の発注、オフィス環境の整備\n・採用活動のサポート（日程調整、応募者対応）\n・社内イベントの企画運営",
      },
    ],
  },
  {
    workKey: "work3-gyoshu-bunrui",
    items: [
      {
        itemCode: "J-15",
        title: "営業事務（土日祝休み／板橋区）",
        jobContent:
          "自社工場で製造した建築資材の受発注業務をお任せします。\n・受注入力、工場への生産依頼\n・在庫確認、納期回答\n・出荷指示、送り状の作成\n・請求書、見積書の作成\n\n【この会社の位置づけ】\n自社の工場で製品を製造し、商社や工務店へ販売しています。",
      },
      {
        itemCode: "J-16",
        title: "営業事務（土日祝休み／江東区）",
        jobContent:
          "メーカーから仕入れた建築資材の受発注業務をお任せします。\n・工務店、住宅メーカーからの注文受付（FAX、メール）\n・仕入先メーカーへの発注、納期調整\n・注文書のチェック、入力\n・請求書の発行、売掛金の確認\n\n【この会社の位置づけ】\n工場は持たず、複数のメーカーから資材を仕入れて、工務店や住宅メーカーへ販売しています。",
      },
      {
        itemCode: "J-10",
        title: "経理担当（月次決算／簿記3級以上）",
        jobContent:
          "株式会社ニューフィールドの経理部にて以下の業務をお任せします。\n・伝票の起票、仕訳入力\n・月次決算、年次決算の補助\n・売掛金、買掛金の管理\n・支払処理、請求書の発行\n\n【応募資格・必須条件】\n・事業会社での経理実務経験が1年以上ある方\n・日商簿記3級以上をお持ちの方",
      },
      {
        itemCode: "J-18",
        title: "経理アシスタント（簿記の資格を活かせる）",
        jobContent:
          "税理士法人 みらいパートナーズにて、顧問先企業の会計、税務業務をサポートします。\n・仕訳入力、月次試算表の作成\n・顧問先への訪問、資料の回収\n・決算業務の補助\n・税務申告書の作成補助\n\n【応募資格・必須条件】\n・日商簿記3級以上をお持ちの方\n・学歴不問／実務未経験歓迎",
      },
    ],
  },
  {
    workKey: "work4-challenge-senbiki",
    items: [
      {
        itemCode: "J-07",
        title: "法人営業（既存顧客中心／インセンティブあり）",
        jobContent:
          "自社開発の業務システムを、既存の法人顧客へ提案します。\n・既存顧客への定期訪問、追加提案\n・顧客の課題ヒアリングと解決策の提示\n・見積書、提案書の作成\n・導入後のフォロー\n\n【必須条件】\n・法人営業の経験が3年以上ある方\n・普通自動車第一種運転免許\n\n【歓迎要件】\n・IT業界での営業経験がある方\n・無形商材の営業経験がある方",
      },
      {
        itemCode: "J-08",
        title: "営業アシスタント（未経験歓迎／東証プライム上場グループ）",
        jobContent:
          "広告の進行管理業務をお任せします。\n・広告原稿のチェック（著作権、表現、法令）\n・各広告媒体の管理画面への入稿作業\n・配信後のレポート作成、数値の集計\n・営業担当のサポート、売上管理\n\n【必須条件】\n・社会人経験1年以上の方\n・学歴不問／業種職種未経験歓迎\n\n【歓迎要件】\n・営業事務、事務職の経験がある方\n・Excel中級以上（関数、ピボットテーブル）のスキルをお持ちの方\n・広告業界での就業経験がある方",
      },
      {
        itemCode: "J-09",
        title: "営業事務（土日祝休み）",
        jobContent:
          "営業部門の事務サポートをお任せします。\n・受注データの入力、納期の調整\n・見積書、請求書の作成\n・電話、メールでの取引先対応\n・展示会の準備補助\n\n【必須条件】\n・ExcelやWordを使用できる方\n・学歴不問／未経験歓迎\n\n【歓迎要件】\n・営業事務の経験をお持ちの方\n・製造業界での就業経験がある方",
      },
    ],
  },
];

async function main() {
  // 事故防止: 既存ワーク⓪の workKey がこの seed に混ざっていたら何もしない
  if (WORKS.some((w) => w.workKey === PROTECTED_WORK_KEY)) {
    throw new Error(`この seed で ${PROTECTED_WORK_KEY} を触ってはいけません`);
  }

  let total = 0;
  for (const work of WORKS) {
    for (const [i, item] of work.items.entries()) {
      const data = {
        sortOrder: i + 1,
        title: item.title,
        jobContent: item.jobContent,
        isActive: true,
      };
      await prisma.trainingWorkItem.upsert({
        where: { workKey_itemCode: { workKey: work.workKey, itemCode: item.itemCode } },
        update: data,
        create: { workKey: work.workKey, itemCode: item.itemCode, ...data },
      });
      total++;
    }
    console.log(`  ${work.workKey} : ${work.items.length}件`);
  }
  console.log(`Seeded ${total} training work items (works 1-4)`);

  const untouched = await prisma.trainingWorkItem.count({ where: { workKey: PROTECTED_WORK_KEY } });
  console.log(`ワーク⓪の設問件数（変化していないこと）: ${untouched}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

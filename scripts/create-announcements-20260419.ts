import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const AUTHOR_ID = "cml9jturt00037k4ftqsi6yvz"; // 大野 将幸

const announcements = [
  {
    title: "求人マイページ 機能アップデートのお知らせ",
    category: "FEATURE" as const,
    content: `求人マイページに以下の機能を追加しました。

■ 1. 求人の仕分け機能（保留・対象外）

求職者がマイページ上で求人を仕分けできるようになりました。

【求職者側】
・各求人カードの右上メニュー（⋮）から「保留にする」「対象外にする」を選択可能
・チェックボックスによる一括操作にも対応
・「保留」は求職者に引き続き表示され、後から「気になる」「応募したい」に変更可能
・「対象外」にした求人は求職者の画面から非表示になります

【管理者（CA）側】
・管理者プレビューに「対象外」タブが追加されました
・対象外タブでは非表示にした求人の一覧を確認できます
・「復活する」ボタンで対象外にした求人を未回答に戻すことができます
・ポータルの求職者詳細から求人を削除した場合も、マイページの対象外タブに反映されます

■ 2. 求人詳細の「お仕事内容」表示

「この求人について詳しく見る」モーダルに「▶ お仕事内容」セクションを追加しました。
AIが求人内容をもとに、具体的な業務イメージがわかるように3〜5行で要約します。
「▶ こんな会社です」と「▶ ○○様との相性」の間に表示されます。
※ 新規にAI解説を生成した求人から順次表示されます。

■ 3. 管理者による求人情報の直接編集

管理者プレビュー画面で、求人の各フィールドを直接編集できるようになりました。
AI抽出結果の誤り（住所が本社表記になる等）をその場で修正可能です。
対象フィールド：会社名、求人タイトル、勤務地、最寄り駅、仕事内容、残業、年収、賞与、休日、応募要件、福利厚生、転勤、企業ホームページURL
※ 編集ボタンは管理者プレビューでのみ表示されます。求職者には表示されません。

■ 適用日
2026年4月19日〜`,
  },
];

async function main() {
  const now = new Date("2026-04-19T09:00:00+09:00");

  for (let i = 0; i < announcements.length; i++) {
    const a = announcements[i];
    const publishedAt = new Date(now.getTime() + i * 60000);

    await prisma.announcement.create({
      data: {
        title: a.title,
        content: a.content,
        category: a.category,
        status: "PUBLISHED",
        publishedAt,
        authorUserId: AUTHOR_ID,
      },
    });

    console.log(`Created: [${a.category}] ${a.title}`);
  }

  console.log(`\nDone: ${announcements.length} announcements created`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

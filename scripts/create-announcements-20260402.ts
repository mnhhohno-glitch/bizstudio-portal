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
    title: "求職者の支援ステータス管理機能を追加しました",
    category: "FEATURE" as const,
    content: `求職者を「支援前」「支援中」「支援終了」の3つのステータスで管理できるようになりました。

【求職者一覧】
・画面上部にタブを追加: ALL / 支援中 / 支援終了 / 支援前
・タブ切り替えでステータス別にフィルタできます（既存の検索との併用も可能）
・各タブに件数バッジが表示されます
・テーブルにステータス列を追加。インラインで変更可能です

【求職者詳細】
・ヘッダーの「基本情報を編集」ボタンの横にステータスバッジを表示
・クリックでステータスを変更できます

全求職者は初期状態で「支援前」に設定されています。状況に応じて「支援中」「支援終了」に変更してください。`,
  },
  {
    title: "支援終了時の理由選択機能を追加しました",
    category: "FEATURE" as const,
    content: `求職者のステータスを「支援終了」に変更する際、終了理由を選択できるようになりました。

【終了理由の種類】
・入社決定 / 内定辞退（他社決定） / 内定辞退（自社他） / 選考中辞退 / 選考落ち
・他社決定（エントリー前） / 転職活動中止 / 希望条件不一致 / 連絡不通 / 紹介対象外
・応募後音信不通 / 面談設定辞退 / 面談後連絡不通 / その他（自由記述）

【エントリー管理との自動連動】
エントリーボードでフラグを変更した際、全エントリーが終了状態になると支援終了が自動セットされます。
・例: 最後のエントリーが「入社済」→ 支援終了（入社決定）に自動変更
・選考中のエントリーが残っている場合は自動終了しません

「支援前」「支援中」に戻す際は終了理由がクリアされます。`,
  },
];

async function main() {
  const now = new Date("2026-04-02T09:00:00+09:00");

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

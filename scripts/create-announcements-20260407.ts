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
    title: "ブックマーク求人分析が3軸マトリックス評価になりました",
    category: "FIX" as const,
    content: `AIアドバイザーのブックマーク求人分析（全件分析・追加のみ分析）の評価が1軸から3軸に変わりました。

【3つの評価軸】
・本人希望: 求職者の希望条件・志向性とのマッチ度（A〜D）
・通過率: 書類選考・面接の通過可能性（A〜D）
・総合: 上記を踏まえた紹介推奨度（A〜D）

「本人は希望に合うが通過は厳しい」といった判断がひと目で分かります。
ブックマーク一覧のバッジは総合評価で表示されます。バッジクリックで詳細コメントも確認できます。`,
  },
  {
    title: "求人出力の処理フローを変更しました",
    category: "FIX" as const,
    content: `ブックマークから「求人出力へ送信」した際の処理フローを変更しました。

【変更前】
PDF送信 → メモ生成 → 自動で抽出開始（引当て確認なしで進んでしまう）

【変更後】
PDF送信 → メモ生成 → メモ一覧ページで停止

メモ一覧ページでPDFとメモの引当て（紐付け）を確認してから、手動で抽出を開始してください。
これにより、引当てミスによる抽出エラーを防げます。`,
  },
  {
    title: "求職者一覧に詳細フィルタを追加しました",
    category: "FEATURE" as const,
    content: `求職者一覧に以下のフィルタを追加しました。検索バーの下に表示されています。

・担当CA: ドロップダウンでCA別に絞り込み
・登録日: 開始日〜終了日の範囲で絞り込み
・性別: 男性 / 女性 で絞り込み
・支援終了理由: 支援終了タブ選択時のみ表示、理由別に絞り込み

フリーワード検索や支援ステータスタブとの併用も可能です。`,
  },
  {
    title: "求人出力のエリア選択を地域グループ化しました",
    category: "FIX" as const,
    content: `ブックマークから「求人出力へ送信」する際のエリア選択を改善しました。

【地域グループ】
・首都圏（東京都・神奈川県・埼玉県・千葉県）
・関西（大阪府・兵庫県・京都府）
・東海（愛知県・静岡県）

グループをチェックすると配下の都道府県がまとめて選択されます。
上記以外の都道府県は「その他」から検索・選択できます。`,
  },
  {
    title: "ブックマーク一覧にソート機能を追加しました",
    category: "FEATURE" as const,
    content: `求職者詳細ページのブックマーク一覧にテーブルヘッダーとソート機能を追加しました。

【テーブルヘッダー】
会社名 / 評価 / 担当 / 紹介日 のカラムヘッダーが表示されます。

【ソート機能】
各カラムのヘッダーをクリックすると、昇順→降順→解除の3段階でソートできます。
・評価: A→B→C→D順、またはD→C→B→A順
・紹介日: 新しい順、または古い順

また、求人出力へ送信する際もAI評価順（A→D）でファイルが自動ソートされます。`,
  },
];

async function main() {
  const now = new Date("2026-04-07T09:00:00+09:00");

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

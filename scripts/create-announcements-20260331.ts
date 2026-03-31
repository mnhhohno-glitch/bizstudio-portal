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
    title: "Googleカレンダーとの双方向同期に対応しました（再連携が必要です）",
    category: "IMPORTANT" as const,
    content: `これまではGoogleカレンダーの予定をポータルに表示するだけでしたが、ポータルで作成・編集・削除した予定がGoogleカレンダーにも自動反映されるようになりました。

ポータルとGoogleカレンダーのどちらで予定を管理してもズレが出なくなります。

⚠️ 再連携が必要です
新しい権限（カレンダーの編集権限）が必要なため、デイリースケジュールのGoogleカレンダー連携を一度解除して再連携してください。

【手順】
1. デイリースケジュール → 「Googleカレンダー連携中」の横の「解除」をクリック
2. 再度「Googleカレンダー連携」をクリック
3. Googleの画面で「許可」を押す

再連携後は、ポータルで作成した予定が自動的にGoogleカレンダーに同期されます。`,
  },
  {
    title: "面談サブタブから面談登録が直接できるようになりました",
    category: "FEATURE" as const,
    content: `求職者詳細ページの「面談」サブタブに「📝 面談登録」ボタンを追加しました。

【これまで】
サイドバー「面談登録」→ 面談登録アプリで求職者を検索・選択 → ファイルを手動添付

【アップデート後】
求職者詳細 → 面談サブタブ → 「📝 面談登録」ボタン → 求職者が自動選択＆面談タブのファイルが自動添付された状態で面談登録アプリが開きます

求職者の選び直しやファイルの再添付が不要になり、面談登録の手間が大幅に減ります。
また、面談サブタブへのドラッグ＆ドロップによるファイルアップロードにも対応しました。`,
  },
  {
    title: "タスク ⇔ 求職者書類のファイル連携機能を追加しました",
    category: "FEATURE" as const,
    content: `書類タブの各サブタブとタスクの間で、ファイルをダウンロード不要で直接やり取りできるようになりました。

【求職者の書類タブ】
・各ファイルにチェックボックスを追加（個別選択・全選択対応）
・「📎 タスクに添付」— 選択したファイルを既存タスクに直接添付
・「📥 一括ダウンロード」— 選択したファイルをまとめてダウンロード
・「🗑 一括削除」— 選択したファイルをまとめて削除

【タスク詳細画面】
・添付ファイルにチェックボックスを追加
・「📁 求職者フォルダへ保存」— 選択したファイルを求職者の指定サブタブにコピー保存
・「📥 一括ダウンロード」— 選択したファイルをまとめてダウンロード

【タスク作成画面】
・「📁 求職者ファイルから選択」ボタンを追加。求職者のフォルダを閲覧し、既存ファイルを直接添付できます`,
  },
  {
    title: "AIアドバイザーの回答品質とUIを大幅改善しました",
    category: "FIX" as const,
    content: `【回答スタイルの改善】
質問の内容に応じて回答の長さを調整するようになりました。短い質問には簡潔に、深い相談には詳しく回答します。話題の区切りで段落分けや見出しが入り、読みやすくなりました。

【ブックマーク求人分析の強化】
評価が1軸（相性A/B/C/D）から3軸マトリックスに変わりました。
・本人希望 — 求職者の希望条件・志向性とのマッチ度
・通過率 — 書類選考・面接の通過可能性
・総合 — 上記を踏まえた紹介推奨度
「本人は希望に合うが通過は厳しい」といった判断がひと目で分かります。

【パネル幅の拡張】
AIアドバイザーのパネル幅を画面の約50%に拡張し、分析結果やアドバイスが読みやすくなりました。`,
  },
  {
    title: "書類共有URL機能の改善",
    category: "FIX" as const,
    content: `【選択ファイルのURL発行】
BS作成書類サブタブで、チェックボックスで選択したファイルだけを対象にURLを一括発行できるようになりました。これまでは「全件一括」か「1件ずつ」のみでしたが、必要なファイルだけを選んで発行できます。

【コピーボタンのフィードバック】
共有URL発行後の「コピー」ボタンを押すと「✅ コピーしました」と表示されるようになりました。

【リンクプレビューの改善】
共有URLをLINE等で求職者に送った際のリンクプレビュー表示を「書類のご確認 | 株式会社ビズスタジオ」に変更しました（「社内ポータル」の表記を削除）。`,
  },
];

async function main() {
  const now = new Date("2026-03-31T09:00:00+09:00");

  for (let i = 0; i < announcements.length; i++) {
    const a = announcements[i];
    // Offset each by 1 minute so ordering is predictable
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

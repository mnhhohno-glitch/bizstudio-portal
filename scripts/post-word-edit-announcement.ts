import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TITLE = "【新機能】BS作成書類のWord直接編集ができるようになりました";

const CONTENT = `応募書類（.docx）をポータル上で直接ダウンロード→編集→アップロードできるようになりました。
従来のGoogle DocsやOffice Onlineでの編集で発生していたフォント崩れ・レイアウト崩れを回避し、ローカルのWord（MOS）で編集できるようになります。

■ 使い方

① Word編集ボタンをクリック
候補者詳細 → ドキュメントタブ → BS作成書類の「.docx」ファイル右側にある「Word編集」ボタンを押す

② ダウンロードして保存
「名前を付けて保存」ダイアログが表示されるので、ダウンロードフォルダなど任意の場所に一時保存

③ Wordで編集
ダウンロードしたファイルを開き、必要な編集を済ませて保存

④ 編集済みをアップロード
ポータルに戻ると、該当ファイルに「編集中」表示と「編集済みをアップロード」ボタンが表示されます。ボタンをクリックして保存したファイルを選択すると、ポータル上の書類が更新されます。
PDFも自動で再生成されるので、PDF側も最新の状態に更新されます。

■ 補足

・「.docx」ファイルのみ対応（PDFには「Word編集」ボタンは表示されません）
・編集を取りやめる場合は「キャンセル」ボタンで編集状態を解除できます
・ダウンロード済みのファイルはお手元のPCに残ります。必要に応じて整理してください

何か不具合があればSlackまたは直接ご連絡ください。`;

const AUTHOR_USER_ID = "cml9jturt00037k4ftqsi6yvz";

async function main() {
  const existing = await prisma.announcement.findFirst({
    where: { title: TITLE },
  });
  if (existing) {
    console.log("Already posted. Skipping. ID:", existing.id);
    await pool.end();
    return;
  }

  const announcement = await prisma.announcement.create({
    data: {
      title: TITLE,
      content: CONTENT,
      category: "FEATURE",
      status: "PUBLISHED",
      publishedAt: new Date(),
      authorUserId: AUTHOR_USER_ID,
    },
  });

  console.log("Announcement created:", announcement.id);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});

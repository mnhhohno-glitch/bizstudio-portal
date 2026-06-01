import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TITLE = "面談ログ・資料の添付場所が1つにまとまりました";

const CONTENT = `これまで、面談ログやマイナビからのダウンロード資料を添付する場所が
「面談履歴の入力画面」と「書類タブの面談フォルダ」の2か所に分かれており、
同じファイルを両方にアップロードする必要がありました。

今回の改修で、この2か所が連動するようになりました。

【Before】
・面談入力画面の「添付」と、書類タブの「面談」フォルダが別々
・片方にアップロードしても、もう片方には反映されない
・両方に同じファイルをアップロードする手間が発生していた

【After】
・2か所が同じファイルを共有
・どちらか一方にアップロードすれば、両方に表示される
・どちらか一方で削除すれば、両方から消える
・AIによる面談ログの自動入力も、どちらにアップしたファイルでも使える

今後は、面談ログ・資料のアップロードはどちらか好きな方で1回行えばOKです。

※ これまでに追加された過去のファイルもすべて新しい仕組みへ移行済みです。
　 これまで通りご覧いただけます。`;

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

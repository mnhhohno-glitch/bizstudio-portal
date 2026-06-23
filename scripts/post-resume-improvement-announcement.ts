import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TITLE = "【改善のお知らせ】履歴書生成の精度が大幅に向上しました";

const CONTENT = `ai-resume-generator（履歴書・職務経歴書 自動生成ツール）の精度を大幅に改善しました。

■ 改善された内容

・履歴書生成中のエラー（429エラー）が解消されました
  → 安定して書類が生成されるようになります

・Googleフォームの回答が正しく履歴書に反映されるようになりました
  以下の情報が自動で取得できるようになっています:
  ・学歴（高校名・短大名、入学・卒業年月）
  ・業務内容（フォームのチェック項目すべて）
  ・工夫していること（フォームのチェック項目すべて)
  ・法人名と配属園名（正式名称で結合）
  ・各種資格の取得年月

・学歴の並び順をドラッグ&ドロップで修正できるようになりました
  → 自動抽出が完璧でない場合、手動で並び替えが可能です

■ 残る制約事項

・短大の卒業年は反映されますが、月情報がフォーム外の場合は空欄になります
・自動抽出が100%完璧ではないため、内容確認・必要に応じて手動修正をお願いします

■ 運用のお願い

自動生成された内容は「叩き台」として確認し、不足や誤りがあれば手動で補正してください。
学歴の順序がおかしい場合はドラッグ&ドロップで並び替えできます。

何か不具合や改善要望があればLINE WORKSまたは直接ご連絡ください。`;

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

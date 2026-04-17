/**
 * 読み取り専用。ファイル単位の raw JSON ダンプ。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const CANDIDATE_ID = "cmnfvise700081dml1b4fw1qt";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Raw SQL で確認
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any = await prisma.$queryRawUnsafe(`
    SELECT id, file_name, ai_match_rating,
           ai_analysis_comment IS NULL AS comment_is_null,
           ai_analysis_comment = '' AS comment_is_empty,
           LENGTH(ai_analysis_comment) AS comment_len,
           updated_at, ai_analyzed_at
    FROM candidate_files
    WHERE candidate_id = $1 AND category = 'BOOKMARK'
    ORDER BY updated_at DESC
  `, CANDIDATE_ID);

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

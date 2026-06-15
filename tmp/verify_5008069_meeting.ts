import { Pool } from "pg";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query(
    `SELECT cf.category, cf.file_name, cf.memo FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id WHERE c.candidate_number = '5008069'`
  );
  console.log("5008069 CandidateFiles:", JSON.stringify(res.rows, null, 2));
  await pool.end();
}
main().catch(console.error);

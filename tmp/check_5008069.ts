import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const cRes = await pool.query(
    'SELECT id, candidate_number, name, created_at, application_route, media_source, recruiter_name FROM candidates WHERE candidate_number = $1',
    ["5008069"]
  );
  console.log("=== Candidate ===");
  console.log(JSON.stringify(cRes.rows, null, 2));
  if (cRes.rows.length === 0) { console.log("NOT FOUND"); await pool.end(); return; }

  const candidateId = cRes.rows[0].id;

  const fRes = await pool.query(
    'SELECT id, category, file_name, file_size, drive_file_id, memo, created_at FROM candidate_files WHERE candidate_id = $1 ORDER BY created_at ASC',
    [candidateId]
  );
  console.log("\n=== CandidateFile ===");
  console.log(JSON.stringify(fRes.rows, null, 2));

  const iRes = await pool.query(
    'SELECT id, interview_date, interview_type, created_at FROM interview_records WHERE candidate_id = $1',
    [candidateId]
  );
  console.log("\n=== InterviewRecord ===");
  console.log(JSON.stringify(iRes.rows, null, 2));

  const lRes = await pool.query(
    'SELECT id, batch_id, status, reason, candidate_id, candidate_name, pdf_file_name, pdf_file_id, error_message, created_at FROM mynavi_rpa_processing_logs WHERE candidate_name LIKE $1 ORDER BY created_at DESC LIMIT 5',
    ["%今井%"]
  );
  console.log("\n=== MynaviRpaProcessingLog ===");
  console.log(JSON.stringify(lRes.rows, null, 2));

  await pool.end();
}

main().catch(console.error);

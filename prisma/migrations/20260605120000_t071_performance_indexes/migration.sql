-- T-071: 実績表（CA 別 × 期間レンジ）の集計クエリ用インデックス追加。
--
-- 集計パターンは WHERE <key> = X AND <dateField> BETWEEN from AND to なので、
-- (key, dateField) の複合インデックスが最も効く。
--
-- ロックについて：
--   prisma migrate deploy は各 migration を 1 トランザクションで実行するため、
--   `CREATE INDEX CONCURRENTLY`（トランザクション内不可）は使えない。
--   対象テーブルは現状数千行規模で、通常の CREATE INDEX のロック時間は数ミリ秒のため
--   共有 DB でも実害なし。IF NOT EXISTS で冪等化し、再適用しても失敗しない。

-- 面談：interviewer_user_id（Employee.id）× interview_date
CREATE INDEX IF NOT EXISTS "interview_records_interviewer_user_id_interview_date_idx"
  ON "interview_records" ("interviewer_user_id", "interview_date");

-- 求人検索：uploaded_by_user_id（User.id）× created_at
CREATE INDEX IF NOT EXISTS "candidate_files_uploaded_by_user_id_created_at_idx"
  ON "candidate_files" ("uploaded_by_user_id", "created_at");

-- 求人紹介：uploaded_by_user_id（User.id）× last_exported_at
CREATE INDEX IF NOT EXISTS "candidate_files_uploaded_by_user_id_last_exported_at_idx"
  ON "candidate_files" ("uploaded_by_user_id", "last_exported_at");

-- エントリー以降：career_advisor_id（Employee.id）× 各日付フィールド
CREATE INDEX IF NOT EXISTS "job_entries_career_advisor_id_entry_date_idx"
  ON "job_entries" ("career_advisor_id", "entry_date");

CREATE INDEX IF NOT EXISTS "job_entries_career_advisor_id_document_pass_date_idx"
  ON "job_entries" ("career_advisor_id", "document_pass_date");

CREATE INDEX IF NOT EXISTS "job_entries_career_advisor_id_offer_date_idx"
  ON "job_entries" ("career_advisor_id", "offer_date");

CREATE INDEX IF NOT EXISTS "job_entries_career_advisor_id_acceptance_date_idx"
  ON "job_entries" ("career_advisor_id", "acceptance_date");

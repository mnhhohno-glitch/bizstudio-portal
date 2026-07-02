-- T-128 T2: 求職者サイト向けAPI（お気に入り・応募）。
-- additive のみ（既存テーブル・既存行に一切触らない・冪等）。
--   1) candidate_files.origin: 追加元の区別（null/"ca"=CA追加, "candidate"=本人追加）。既存行は NULL のまま＝CA扱い。
--   2) candidate_job_applications: 応募受付の軽量記録テーブル（記録＋CA通知のみ。エントリー正式連携は後続フェーズ）。
--
-- 安全弁: ALTER TABLE は一瞬の ACCESS EXCLUSIVE を要する。長時間クエリがロックを保持していた場合に
-- ロック待ちキューで後続クエリを全部詰まらせないよう、5秒で諦めて失敗させる（冪等なので再実行可）。
SET lock_timeout = '5s';

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "origin" TEXT;

CREATE TABLE IF NOT EXISTS "candidate_job_applications" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "external_job_ref" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "candidate_job_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "candidate_job_applications_candidate_id_external_job_ref_key" ON "candidate_job_applications"("candidate_id", "external_job_ref");
CREATE INDEX IF NOT EXISTS "candidate_job_applications_candidate_id_idx" ON "candidate_job_applications"("candidate_id");

-- FK（既存 candidates への参照・onDelete Cascade）。既存 candidate_saved_jobs と同方針。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'candidate_job_applications_candidate_id_fkey'
  ) THEN
    ALTER TABLE "candidate_job_applications"
      ADD CONSTRAINT "candidate_job_applications_candidate_id_fkey"
      FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

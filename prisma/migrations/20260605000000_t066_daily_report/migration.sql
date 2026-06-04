-- T-066: 日報・予実管理機能のスキーマ追加（非破壊）
-- 1) Employee に職種フラグ追加（nullable、既存レコードは NULL）
-- 2) DailyReport / DailyReportChat モデル新設
-- 全変更を IF NOT EXISTS でガードし、既存環境（同名カラム・テーブルが既に存在しても）でも失敗しない。

-- ============================================================
-- 1. EmployeeJobCategory enum
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EmployeeJobCategory') THEN
    CREATE TYPE "EmployeeJobCategory" AS ENUM ('CA', 'MARKETING', 'OFFICE_AND_MGMT');
  END IF;
END$$;

-- ============================================================
-- 2. employees.job_category 列追加（nullable）
-- ============================================================
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "job_category" "EmployeeJobCategory";

-- ============================================================
-- 3. DailyReportStatus enum
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DailyReportStatus') THEN
    CREATE TYPE "DailyReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');
  END IF;
END$$;

-- ============================================================
-- 4. daily_reports テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS "daily_reports" (
  "id"            TEXT NOT NULL,
  "user_id"       TEXT NOT NULL,
  "date"          DATE NOT NULL,
  "job_category"  "EmployeeJobCategory",
  "numbers"       JSONB,
  "comment"       TEXT,
  "ai_body"       TEXT,
  "status"        "DailyReportStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_at"  TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_reports_user_id_date_key" ON "daily_reports"("user_id", "date");
CREATE INDEX IF NOT EXISTS "daily_reports_user_id_idx" ON "daily_reports"("user_id");
CREATE INDEX IF NOT EXISTS "daily_reports_date_idx" ON "daily_reports"("date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_reports_user_id_fkey'
  ) THEN
    ALTER TABLE "daily_reports"
      ADD CONSTRAINT "daily_reports_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

-- ============================================================
-- 5. daily_report_chats テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS "daily_report_chats" (
  "id"              TEXT NOT NULL,
  "daily_report_id" TEXT NOT NULL,
  "role"            "ChatRole" NOT NULL,
  "content"         TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_report_chats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "daily_report_chats_daily_report_id_idx" ON "daily_report_chats"("daily_report_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_report_chats_daily_report_id_fkey'
  ) THEN
    ALTER TABLE "daily_report_chats"
      ADD CONSTRAINT "daily_report_chats_daily_report_id_fkey"
      FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

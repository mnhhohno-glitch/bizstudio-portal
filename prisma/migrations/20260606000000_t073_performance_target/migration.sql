-- T-073: 実績表の CA 月次目標テーブル（非破壊・idempotent）。
-- 祝日マスタは @holiday-jp/holiday_jp ライブラリを使うため DB テーブルは不要。
-- 本 migration は performance_targets テーブルのみ追加する。
-- prisma migrate deploy はトランザクション内実行のため CONCURRENTLY は使わず、
-- CREATE TABLE/INDEX IF NOT EXISTS で冪等化（新規テーブルなのでロック影響なし）。

CREATE TABLE IF NOT EXISTS "performance_targets" (
  "id"                       TEXT NOT NULL,
  "employee_id"              TEXT NOT NULL,
  "year_month"               TEXT NOT NULL,
  "target_revenue"           DOUBLE PRECISION NOT NULL,
  "unit_price"               DOUBLE PRECISION NOT NULL,
  "interview_count"          DOUBLE PRECISION NOT NULL,
  "existing_interview_count" DOUBLE PRECISION,
  "interview_prep_count"     DOUBLE PRECISION,
  "introduction_count"       DOUBLE PRECISION NOT NULL,
  "entry_count"              DOUBLE PRECISION NOT NULL,
  "document_pass_count"      DOUBLE PRECISION NOT NULL,
  "offer_count"              DOUBLE PRECISION NOT NULL,
  "acceptance_count"         DOUBLE PRECISION NOT NULL,
  "introduction_rate"        DOUBLE PRECISION NOT NULL,
  "entry_rate"               DOUBLE PRECISION NOT NULL,
  "document_pass_rate"       DOUBLE PRECISION NOT NULL,
  "offer_rate"               DOUBLE PRECISION NOT NULL,
  "acceptance_rate"          DOUBLE PRECISION NOT NULL,
  "created_by"               TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_targets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "performance_targets_employee_id_year_month_key"
  ON "performance_targets" ("employee_id", "year_month");
CREATE INDEX IF NOT EXISTS "performance_targets_employee_id_idx"
  ON "performance_targets" ("employee_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'performance_targets_employee_id_fkey'
  ) THEN
    ALTER TABLE "performance_targets"
      ADD CONSTRAINT "performance_targets_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

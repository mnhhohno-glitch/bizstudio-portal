-- T-088：承諾レコードの課金方式と年収/手数料%カラム（additive・冪等）
-- 既存 revenue (Int?) は変更しない。確定粗利のSSoTとして引き続き使う。

-- enum 追加（冪等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeeType') THEN
    CREATE TYPE "FeeType" AS ENUM ('ANNUAL_RATE', 'FIXED');
  END IF;
END
$$;

-- カラム追加（冪等）
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "fee_type" "FeeType";
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "theoretical_annual_income" INTEGER;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "fee_rate_percent" DECIMAL(5,2);

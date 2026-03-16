ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "is_exempt_from_attendance" BOOLEAN NOT NULL DEFAULT false;

-- 役員（1000001 大野 将幸）を打刻不要に設定
UPDATE "employees" SET "is_exempt_from_attendance" = true WHERE "employee_number" = '1000001';

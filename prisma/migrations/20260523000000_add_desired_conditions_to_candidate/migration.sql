-- AlterTable
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_job_type_1" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_job_type_2" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_industry_1" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_prefecture" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_employment_type" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_salary_min" INTEGER;
